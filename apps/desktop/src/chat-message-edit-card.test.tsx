// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MessageEditCard } from './chat-message-edit-card';
import type { ComposerDockProps } from './composer-dock';
import { DesktopLocaleProvider } from './desktop-locale-context';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const composerCard: ComposerDockProps = {
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

function renderCard(node: ReactElement): { container: HTMLElement; root: Root } {
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

describe('MessageEditCard carry-through send', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      const mounted = root;
      act(() => {
        mounted.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('sends empty text when the original turn still has attachments', () => {
    const onResend = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText=""
        composerCard={composerCard}
        hasCarryContent={true}
        onCancel={vi.fn()}
        onResend={onResend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.disabled).toBe(false);
    act(() => {
      sendBtn?.click();
    });
    expect(onResend).toHaveBeenCalledWith('');
  });

  it('does not send empty text when the original turn had no attachments', () => {
    const onResend = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText=""
        composerCard={composerCard}
        onCancel={vi.fn()}
        onResend={onResend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.disabled).toBe(true);
    act(() => {
      sendBtn?.click();
    });
    expect(onResend).not.toHaveBeenCalled();
  });

  it('labels unchanged current-turn send as Retry', () => {
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="same turn"
        composerCard={composerCard}
        currentTurn
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.getAttribute('aria-label')).toBe('Retry');
  });

  it('labels an older unchanged send as a new version', () => {
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="same turn"
        composerCard={composerCard}
        currentTurn={false}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.getAttribute('aria-label')).toBe('Send new version');
  });
});
