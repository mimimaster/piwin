// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  BundledPluginSummary,
  HostResponse,
  InstalledPlugin,
  PluginInstallSource,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context.js';
import { PluginsPanel } from './PluginsPanel.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type PluginCommand = {
  type: string;
  source?: PluginInstallSource;
  pluginId?: string;
  secrets?: Record<string, string>;
};

function installedCloudflare(): InstalledPlugin {
  return {
    id: 'cloudflare',
    version: '1.0.0',
    name: 'Cloudflare',
    installedAt: '2026-08-17T00:00:00.000Z',
    source: { kind: 'bundled', bundledId: 'cloudflare' },
    skills: [],
    mcpServerIds: ['plugin__cloudflare__api'],
    secrets: [],
    manifestPath: '/tmp/plugin.json',
  };
}

function bundledRow(id: string, name: string): BundledPluginSummary {
  return {
    id,
    name,
    version: '1.0.0',
    skillCount: 0,
    mcpServerCount: 1,
    secretCount: 0,
    secretNames: [],
  };
}

function createRequest(
  installed: InstalledPlugin[] = [],
  bundled: BundledPluginSummary[] = [],
) {
  const plugins = [...installed];
  const calls: PluginCommand[] = [];
  const request = vi.fn(async (command: PluginCommand): Promise<HostResponse> => {
    calls.push(command);
    if (command.type === 'plugins/list') {
      return {
        type: 'response',
        command: 'plugins/list',
        success: true,
        data: { plugins, bundled },
      };
    }
    if (command.type === 'plugins/install') {
      if (command.source?.kind === 'bundled') {
        plugins.push({
          ...installedCloudflare(),
          id: command.source.bundledId,
          name: command.source.bundledId === 'github' ? 'GitHub' : 'Cloudflare',
          source: command.source,
        });
      }
      return {
        type: 'response',
        command: 'plugins/install',
        success: true,
        data: { pluginId: 'ok', installedSkills: [], mcpServerIds: [], secretRefs: [] },
      };
    }
    return { type: 'response', command: command.type, success: true, data: {} };
  });
  return { request, calls, plugins };
}

async function renderPanel(
  request: (command: PluginCommand) => Promise<HostResponse>,
  feedback?: { onError?: (message: string | null) => void; onInfo?: (message: string | null) => void },
): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
            <PluginsPanel
              request={request as never}
              variant="inline"
              {...(feedback?.onError ? { onError: feedback.onError } : {})}
              {...(feedback?.onInfo ? { onInfo: feedback.onInfo } : {})}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container, root };
}

describe('PluginsPanel', () => {
  let mounted: { container: HTMLDivElement; root: Root } | null = null;

  afterEach(() => {
    if (mounted) {
      const { root, container } = mounted;
      act(() => root.unmount());
      container.remove();
      mounted = null;
    }
  });

  it('shows installed plugins directly, with no built-in marketplace', async () => {
    const { request } = createRequest([installedCloudflare()]);
    mounted = await renderPanel(request);
    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Cloudflare');
    expect(mounted.container.querySelector('[data-testid="plugin-market-tabs"]')).toBeNull();
    expect(mounted.container.querySelector('[data-testid="plugin-market-featured"]')).toBeNull();
  });

  it('lists the built-in plugins and leaves Figma out', async () => {
    const { request } = createRequest([], [
      bundledRow('cloudflare', 'Cloudflare'),
      bundledRow('github', 'GitHub'),
      bundledRow('remotion', 'Remotion'),
      bundledRow('hyperframes', 'HyperFrames'),
    ]);
    mounted = await renderPanel(request);
    const text = mounted.container.querySelector('[data-testid="plugins-bundled"]')?.textContent ?? '';
    expect(text).toContain('Cloudflare');
    expect(text).toContain('GitHub');
    expect(text).toContain('Remotion');
    expect(text).toContain('HyperFrames');
    expect(text).not.toContain('Figma');
    expect(mounted.container.textContent).not.toContain('No plugins installed');
  });

  it('sends registry failures to the caller toast and stops the spinner', async () => {
    const onError = vi.fn();
    const request = vi.fn(async (command: PluginCommand): Promise<HostResponse> => {
      if (command.type === 'plugins/registry/list') {
        return {
          type: 'response',
          command: 'plugins/registry/list',
          success: false,
          error: 'Registry fetch failed: 404 Not Found',
        };
      }
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { plugins: [], bundled: [] },
      };
    });
    mounted = await renderPanel(request, { onError });
    const toggle = mounted.container.querySelector('[data-testid="plugins-registry-toggle"]');
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onError).toHaveBeenCalledWith('Registry fetch failed: 404 Not Found');
    expect(mounted.container.querySelector('.ui-feedback-host')).toBeNull();
    expect(mounted.container.querySelector('[data-testid="plugins-registry-spinner"]')).toBeNull();
  });

  it('does not render discovery hint in the plugins panel', async () => {
    const { request, calls } = createRequest();
    mounted = await renderPanel(request);
    expect(
      mounted.container.querySelector('[data-testid="capability-discovery-hint-plugin"]'),
    ).toBeNull();
    expect(calls.some((call) => call.type === 'plugins/install')).toBe(false);
  });
});
