// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ComposerDock, type ComposerDockProps } from './composer-dock';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: null,
  projectTrusted: true,
  activeSessionId: 'session-1',
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: vi.fn(),
  agentMode: 'agent',
  onAgentModeChange: vi.fn(),
  pendingAttachments: [],
  onRemoveAttachment: vi.fn(),
  dropActive: false,
  onDropActiveChange: vi.fn(),
  plusMenuOpen: false,
  onPlusMenuOpenChange: vi.fn(),
  plusSubmenu: 'none',
  onPlusSubmenuChange: vi.fn(),
  modelOptions: [],
  selectedModelKey: 'default',
  onSelectModel: vi.fn(),
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: vi.fn(),
  onOpenSkillsPanel: vi.fn(),
  onOpenMcpPanel: vi.fn(),
  onAttachImage: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSend: vi.fn(),
  onAbort: vi.fn(),
  onCompact: vi.fn(),
  contextUsage: null,
};

function renderDock(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

describe('ComposerDock host status', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('renders host status badge in the bottom left footer row', () => {
    const handleOpenHostSettings = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        hostReady={true}
        hostStatus={{
          mode: 'sdk',
          ready: true,
          mock: false,
          piwinRoot: '/tmp/.piwin',
          activeSessionIds: [],
          capabilities: {
            customTools: true,
            mcpLifecycle: true,
            productTranscript: true,
            compaction: true,
            extensions: true,
            prompts: true,
          },
        }}
        transportLabel="IPC (SDK)"
        onOpenHostSettings={handleOpenHostSettings}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const hostStatusBtn = container.querySelector('[data-testid="composer-host-status"]') as HTMLButtonElement;
    expect(hostStatusBtn).not.toBeNull();
    expect(hostStatusBtn.textContent).toContain('Host: SDK');

    act(() => {
      hostStatusBtn.click();
    });
    expect(handleOpenHostSettings).toHaveBeenCalledTimes(1);
  });

  it('renders connecting state when hostReady is false', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} hostReady={false} />);
    root = rendered.root;
    container = rendered.container;

    const hostStatusBtn = container.querySelector('[data-testid="composer-host-status"]') as HTMLButtonElement;
    expect(hostStatusBtn).not.toBeNull();
    expect(hostStatusBtn.textContent).toContain('Host: Connecting...');
  });

  it('resets textarea height when composer text is cleared or changed', async () => {
    const rendered = renderDock(<ComposerDock {...baseProps} composer="Hello world" />);
    root = rendered.root;
    container = rendered.container;

    const textarea = container.querySelector('[data-testid="composer-input"]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Re-render with empty composer (e.g. after sending or clearing)
    await act(async () => {
      rendered.root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ComposerDock {...baseProps} composer="" />
        </PiwinUiProvider>,
      );
      await new Promise((r) => requestAnimationFrame(r));
    });

    expect(textarea.style.height).toBe('auto');
  });
});
