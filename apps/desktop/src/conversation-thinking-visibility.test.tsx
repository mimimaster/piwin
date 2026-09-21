// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi } from './chat-reducer';
import { ConversationResponseContent } from './conversation-response-content';
import { ChatThread } from './chat-thread';
import type { ComposerDockProps } from './composer-dock.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderNode(node: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  mounted.push({ container, root });
  return container;
}

const noop = () => undefined;

const composerCard: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: null,
  projectTrusted: true,
  activeSessionId: null,
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: noop,
  agentMode: 'agent',
  onAgentModeChange: noop,
  pendingAttachments: [],
  onRemoveAttachment: noop,
  dropActive: false,
  onDropActiveChange: noop,
  plusMenuOpen: false,
  onPlusMenuOpenChange: noop,
  plusSubmenu: 'none',
  onPlusSubmenuChange: noop,
  modelOptions: [],
  selectedModelKey: '',
  onSelectModel: noop,
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: noop,
  onOpenSkillsPanel: noop,
  onOpenMcpPanel: noop,
  onAttachFile: noop,
  onAttachImage: noop,
  onPaste: noop,
  onDrop: noop,
  onSend: noop,
  onPause: noop,
  onAbort: noop,
  onCompact: noop,
  contextUsage: null,
  onSteer: noop,
  onFollowUp: noop,
};

function assistant(id: string, thinking: string, text = 'answer'): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking,
    tools: [],
    attachments: [],
    status: 'done',
  };
}

afterEach(() => {
  for (const { container, root } of mounted) {
    try {
      act(() => {
        root.unmount();
      });
      container.remove();
    } catch {
      // cleanup best-effort
    }
  }
  mounted.length = 0;
});

describe('Conversation thinking visibility', () => {
  it('hides the thinking fold when showThinking is false', () => {
    const container = renderNode(
      <ConversationResponseContent
        message={assistant('m-hidden', 'I should search first')}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        showThinking={false}
        artifactInlineEnabled
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking-wrapper"]')).toBeNull();
    expect(container.textContent).toContain('answer');
  });

  it('collapses the thinking body once reasoning has ended', () => {
    const container = renderNode(
      <ConversationResponseContent
        message={{
          id: 'm-ended',
          role: 'assistant',
          text: '<svg>pelican</svg>',
          thinking: 'draw a pelican',
          thinkingStartedAt: 1_000,
          thinkingEndedAt: 3_000,
          tools: [],
          attachments: [],
          status: 'streaming',
        }}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-ended"
        locale="zh-CN"
        isStreaming
        artifactInlineEnabled
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-thinking-wrapper"]')?.className,
    ).toContain('is-collapsed');
    expect(container.querySelector('.work-fold-brain')).not.toBeNull();
  });

  it('keeps the thinking fold when showThinking is omitted', () => {
    const container = renderNode(
      <ConversationResponseContent
        message={assistant('m-shown', 'I should search first')}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactInlineEnabled
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking-wrapper"]')).not.toBeNull();
  });

  it('does not repeat the same thinking on later Conversation replies in one turn', () => {
    const user: ChatMessageUi = {
      id: 'u1',
      role: 'user',
      text: 'go',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const container = renderNode(
      <ChatThread
        messages={[
          user,
          assistant('a1', 'Inspect the project.', 'step one'),
          assistant('a2', 'Inspect the project.', 'step two'),
        ]}
        streaming={false}
        editingMessageId={null}
        lastUserMessageId="u1"
        activeTheme={null}
        artifactThemeKey={0}
        onEdit={noop}
        onCancelEdit={noop}
        onEditResend={noop}
        onRetry={noop}
        onInspectSubagent={undefined}
        composerCard={composerCard}
        locale="zh-CN"
        artifactInlineEnabled
        isConversationSession
        showThinking
      />,
    );

    expect(container.querySelectorAll('[data-testid="conversation-thinking-wrapper"]')).toHaveLength(
      1,
    );
  });
});
