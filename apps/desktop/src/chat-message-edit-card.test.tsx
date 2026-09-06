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

  it('offers Open branch next to Retry on an unchanged current turn', () => {
    const onResend = vi.fn();
    const onOpenBranch = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="same turn"
        composerCard={composerCard}
        currentTurn
        onCancel={vi.fn()}
        onResend={onResend}
        onOpenBranch={onOpenBranch}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    const branchBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="open-branch-btn"]',
    );
    expect(branchBtn?.getAttribute('aria-label')).toBe('Open branch');
    expect(branchBtn?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['btn', 'sm', 'pri']),
    );
    act(() => {
      branchBtn?.click();
    });
    expect(onOpenBranch).toHaveBeenCalledWith('same turn');
    expect(onResend).not.toHaveBeenCalled();
  });

  it('hides Open branch when the send is already a new version', () => {
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="same turn"
        composerCard={composerCard}
        currentTurn={false}
        onCancel={vi.fn()}
        onResend={vi.fn()}
        onOpenBranch={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="open-branch-btn"]')).toBeNull();
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

  it('submits on Enter and ignores Shift+Enter', () => {
    const onResend = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="initial text"
        onCancel={vi.fn()}
        onResend={onResend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();

    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(onResend).not.toHaveBeenCalled();

    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }),
      );
    });
    expect(onResend).toHaveBeenCalledWith('initial text');
  });

  it('cancels on Escape and cancel button click', () => {
    const onCancel = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="initial text"
        onCancel={onCancel}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const cancelBtn = container.querySelector<HTMLButtonElement>('[data-testid="cancel-edit-btn"]');
    act(() => {
      cancelBtn?.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('displays branch hint when editing earlier message or branching', () => {
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="text"
        locale="zh-CN"
        currentTurn={false}
        branchPoint={{
          anchorMessageId: 'p1',
          activeIndex: 0,
          siblings: [
            {
              headMessageId: 'u1',
              role: 'user',
              preview: '1',
              leafPreview: '1',
              messageCount: 1,
              writesWorkspace: false,
              updatedAt: '2026-09-05T14:02:00.000Z',
            },
            {
              headMessageId: 'u2',
              role: 'user',
              preview: '2',
              leafPreview: '2',
              messageCount: 1,
              writesWorkspace: false,
              updatedAt: '2026-09-05T14:03:00.000Z',
            },
          ],
        }}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const efoot = container.querySelector('.efoot');
    expect(efoot?.textContent).toContain('将作为分支 3 / 3');
  });

  it('renders the composer model picker on the edit footer', () => {
    const onSelectModel = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="retry me"
        currentTurn
        composerCard={{
          ...composerCard,
          modelOptions: [
            {
              providerId: 'acme',
              modelId: 'gpt-test',
              label: 'Acme / gpt-test',
              thinkingLevels: ['off', 'medium', 'high'],
              reasoning: true,
            },
            {
              providerId: 'acme',
              modelId: 'gpt-mini',
              label: 'Acme / gpt-mini',
            },
          ],
          selectedModelKey: 'acme::gpt-test',
          thinkingLevel: 'medium',
          onSelectModel,
          onThinkingLevelChange: vi.fn(),
        }}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="thinking-effort-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('gpt-test');

    act(() => {
      trigger?.focus();
      trigger?.click();
    });
    const option = document.querySelector<HTMLButtonElement>(
      '[data-testid="thinking-model-select"] [role="option"][aria-selected="false"]',
    );
    expect(option).not.toBeNull();
    act(() => {
      option?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onSelectModel).toHaveBeenCalledWith('acme::gpt-mini');
  });

  it('does not show the model picker while editing a pending intervention', () => {
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="steer this"
        interventionEdit
        composerCard={{
          ...composerCard,
          modelOptions: [
            { providerId: 'acme', modelId: 'gpt-test', label: 'Acme / gpt-test' },
          ],
          selectedModelKey: 'acme::gpt-test',
        }}
        onCancel={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="thinking-effort-trigger"]')).toBeNull();
  });

  it('does not cancel editing when using the model popover', () => {
    const onCancel = vi.fn();
    const rendered = renderCard(
      <MessageEditCard
        messageId="u1"
        initialText="retry me"
        composerCard={{
          ...composerCard,
          modelOptions: [
            { providerId: 'acme', modelId: 'gpt-test', label: 'Acme / gpt-test' },
          ],
          selectedModelKey: 'acme::gpt-test',
        }}
        onCancel={onCancel}
        onResend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="thinking-effort-trigger"]',
    );
    act(() => {
      trigger?.focus();
      trigger?.click();
    });
    const popover = document.querySelector('[data-testid="thinking-effort-popover"]');
    expect(popover).not.toBeNull();
    act(() => {
      popover?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
