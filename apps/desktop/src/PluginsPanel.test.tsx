// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, InstalledPlugin, PluginInstallSource } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';
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

function createRequest(installed: InstalledPlugin[] = []) {
  const plugins = [...installed];
  const calls: PluginCommand[] = [];
  const request = vi.fn(async (command: PluginCommand): Promise<HostResponse> => {
    calls.push(command);
    if (command.type === 'plugins/list') {
      return { type: 'response', command: 'plugins/list', success: true, data: { plugins } };
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

async function renderPanel(request: (command: PluginCommand) => Promise<HostResponse>): Promise<{
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
            <PluginsPanel request={request as never} variant="inline" />
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

describe('PluginsPanel marketplace', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('shows Cloudflare and GitHub as Featured Add cards', async () => {
    const { request } = createRequest();
    const rendered = await renderPanel(request);
    container = rendered.container;
    root = rendered.root;
    expect(container.querySelector('[data-testid="plugin-market-card-cloudflare"]')?.textContent).toContain(
      'Cloudflare',
    );
    expect(container.querySelector('[data-testid="plugin-market-add-github"]')?.textContent).toContain(
      'Add',
    );
    expect(container.querySelector('[data-testid="plugin-market-card-remotion"]')?.textContent).toContain(
      'Remotion',
    );
    expect(container.querySelector('[data-testid="plugin-market-card-hyperframes"]')?.textContent).toContain(
      'HyperFrames',
    );
    expect(container.querySelector('[data-testid="plugin-market-card-figma"]')?.textContent).toContain(
      'Figma',
    );
  });

  it('adds Cloudflare without a secret dialog', async () => {
    const { request, calls } = createRequest();
    const rendered = await renderPanel(request);
    container = rendered.container;
    root = rendered.root;
    const add = container.querySelector(
      '[data-testid="plugin-market-add-cloudflare"]',
    ) as HTMLButtonElement;
    await act(async () => {
      add.click();
    });
    expect(calls.some((call) => call.type === 'plugins/install' && call.source?.kind === 'bundled')).toBe(
      true,
    );
    expect(container.querySelector('[data-testid="plugin-market-secret-dialog"]')).toBeNull();
  });

  it('asks for a GitHub token before installing', async () => {
    const { request, calls } = createRequest();
    const rendered = await renderPanel(request);
    container = rendered.container;
    root = rendered.root;
    const add = container.querySelector(
      '[data-testid="plugin-market-add-github"]',
    ) as HTMLButtonElement;
    await act(async () => {
      add.click();
      await Promise.resolve();
    });
    const dialog =
      document.body.querySelector('[data-testid="plugin-market-secret-dialog"]') ??
      Array.from(document.body.querySelectorAll('h3')).find((node) =>
        node.textContent?.includes('Add GitHub'),
      );
    expect(dialog).toBeTruthy();
    expect(calls.some((call) => call.type === 'plugins/install')).toBe(false);
  });

  it('marks an already installed plugin as Added', async () => {
    const { request } = createRequest([installedCloudflare()]);
    const rendered = await renderPanel(request);
    container = rendered.container;
    root = rendered.root;
    expect(container.querySelector('[data-testid="plugin-market-added-cloudflare"]')?.textContent).toContain(
      'Added',
    );
    expect(container.querySelector('[data-testid="plugin-market-add-cloudflare"]')).toBeNull();
  });
});
