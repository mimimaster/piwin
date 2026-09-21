// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostClient } from '../../host-client';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import {
  DockToolHostsProvider,
  DockToolSurface,
  type DockToolHosts,
} from './dock-tool-hosts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression: the docked Document surface used to forward only title/content
 * /status, so every failure rendered the generic "Preview unavailable / this
 * file cannot be read right now" — while the inspector path explained the
 * actual reason. These cases pin the forwarded reason.
 */
function hostValues(overrides: Partial<DockToolHosts>): DockToolHosts {
  return {
    hostClient: { supportsCommand: () => true } as unknown as HostClient,
    locale: 'zh-CN',
    activeTheme: PIWIN_APPEARANCE_DARK,
    artifactThemeKey: 'dark',
    projectPath: '/workspace',
    requestGit: vi.fn() as unknown as DockToolHosts['requestGit'],
    addWebElement: vi.fn(),
    artifactTarget: null,
    onInsertCanvasProposal: vi.fn(),
    activeDocument: null,
    inspectorDiff: null,
    ...overrides,
  };
}

describe('docked Document surface', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderDoc(hosts: DockToolHosts): Promise<string> {
    act(() => {
      root.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DockToolHostsProvider value={hosts}>
              <DockToolSurface view={{ viewId: 'doc-1', kind: 'doc' }} />
            </DockToolHostsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });
    // The panel is a lazy surface behind Suspense: give the dynamic import
    // real ticks before reading the rendered text.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      const text = container.textContent ?? '';
      if (text.length > 0 && !container.querySelector('[data-testid="deferred-surface-fallback"]')) {
        return text;
      }
    }
    return container.textContent ?? '';
  }

  it('explains a symlink alias instead of a generic preview failure', async () => {
    const text = await renderDoc(
      hostValues({
        activeDocument: {
          status: 'unavailable',
          requestId: 'r1',
          title: 'shots/01-endpoint-loop.png',
          displayRef: 'shots/01-endpoint-loop.png',
          reason: 'project-root-not-registered',
        },
      }),
    );

    expect(text).toContain('符号链接');
    expect(text).not.toContain('文件当前无法读取');
    expect(text).not.toContain('project-root-not-registered');
  });

  it('asks the user to choose when several files match the name', async () => {
    const text = await renderDoc(
      hostValues({
        activeDocument: {
          status: 'unavailable',
          requestId: 'r2',
          title: 'README.md',
          displayRef: 'README.md',
          reason: 'ambiguous-file',
        },
      }),
    );

    expect(text).toContain('找到多个同名文件');
    expect(text).toContain('文件树');
  });

  it('renders a ready document through the docked surface', async () => {
    const text = await renderDoc(
      hostValues({
        activeDocument: {
          status: 'ready',
          requestId: 'r3',
          title: 'notes.md',
          displayRef: 'notes.md',
          content: 'dock body text',
          provenance: 'project-current',
        },
      }),
    );

    // Title renders without the extension; the body proves the content path.
    expect(text).toContain('dock body text');
    expect(text).toContain('notes');
  });
});
