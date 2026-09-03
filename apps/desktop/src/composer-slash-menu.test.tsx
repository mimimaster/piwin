// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import { DesktopLocaleProvider } from './desktop-locale-context';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: '/p',
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
  onAttachFile: vi.fn(),
  onAttachImage: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSend: vi.fn(),
  onPause: vi.fn(),
  onAbort: vi.fn(),
  onCompact: vi.fn(),
  contextUsage: null,
};

function renderDock(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

describe('composer slash menu skills', () => {
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

  it('lists skills when typing /', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/"
        menuSkills={[{ id: 'create-skill', name: 'create-skill', enabled: true }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-slash-menu"]')).not.toBeNull();
    const skillItem = container.querySelector(
      '[data-testid="slash-item-skill:create-skill"]',
    ) as HTMLButtonElement;
    expect(skillItem).not.toBeNull();
    expect(skillItem.disabled).toBe(false);
  });

  it('lists skills in Conversation without orchestration commands', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        isConversationSession
        composer="/"
        menuSkills={[{ id: 'create-skill', name: 'create-skill', enabled: true }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="slash-item-skill:create-skill"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="slash-item-cmd:ultra-code"]')).toBeNull();
  });

  it('keeps skills selectable in draft before a session exists', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        activeSessionId={null}
        composer="/"
        menuSkills={[{ id: 'create-skill', name: 'create-skill', enabled: true }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const skillItem = container.querySelector(
      '[data-testid="slash-item-skill:create-skill"]',
    ) as HTMLButtonElement;
    expect(skillItem).not.toBeNull();
    expect(skillItem.disabled).toBe(false);
  });
});
