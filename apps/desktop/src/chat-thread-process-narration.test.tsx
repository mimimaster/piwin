// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { ChatMessageUi } from './chat-reducer.js';
import { ChatThread, type ChatThreadProps } from './chat-thread.js';
import type { ComposerDockProps } from './composer-dock.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function noop(): void {
  /* test callback */
}

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
  onPlusMenuOpenChange: noop,
  plusMenuOpen: false,
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
  onDropActiveChange: noop,
};

function userMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'user',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

function assistant(partial: Partial<ChatMessageUi> & Pick<ChatMessageUi, 'id'>): ChatMessageUi {
  return {
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'run-1',
    ...partial,
  };
}

describe('ChatThread process narration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

  function render(messages: ChatMessageUi[], extras: Partial<ChatThreadProps> = {}): void {
    const node: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ChatThread
          messages={messages}
          streaming={false}
          editingMessageId={null}
          lastUserMessageId={messages.find((message) => message.role === 'user')?.id ?? null}
          activeTheme={null}
          artifactThemeKey={0}
          onEdit={noop}
          onCancelEdit={noop}
          onEditResend={noop}
          onRetry={noop}
          onInspectSubagent={undefined}
          composerCard={composerCard}
          locale="zh-CN"
          artifactPreviewEnabled
          {...extras}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(node);
    });
  }

  it('hides Conversation tool-loop captions and keeps actions on the final reply', () => {
    const processCaption = '空框就是中间轮次挂上的复制/再生成栏。接下来只在最后一条保留操作栏。';
    const finalText = '一只大嘴鹈鹕在海岸公路上骑复古自行车。';
    render(
      [
        userMessage('u1', '为什么会话会断裂'),
        assistant({
          id: 'a-process-1',
          text: processCaption,
          thinking: 'Inspect the conversation chrome.',
          tools: [
            { toolCallId: 't1', toolName: 'read', status: 'done', output: 'ok' },
            { toolCallId: 't2', toolName: 'grep', status: 'done', output: 'ok' },
          ],
        }),
        assistant({
          id: 'a-process-2',
          text: processCaption,
          thinking: 'Same caption, next tools.',
          tools: [
            { toolCallId: 't3', toolName: 'artifact_instructions', status: 'done', output: 'ok' },
          ],
        }),
        assistant({
          id: 'a-final',
          text: finalText,
          thinking: 'wrap up',
        }),
      ],
      {
        isConversationSession: true,
        onBranchResend: vi.fn(),
        onForkFromMessage: vi.fn(),
      },
    );

    expect(container.querySelector('#msg-a-process-1 .markdown')).toBeNull();
    expect(container.querySelector('#msg-a-process-2 .markdown')).toBeNull();
    expect(container.querySelector('#msg-a-process-1')?.classList.contains('is-tool-only')).toBe(
      true,
    );
    expect(container.textContent).not.toContain(processCaption);
    expect(container.querySelector('#msg-a-final .markdown')?.textContent).toContain(finalText);
    expect(
      container.querySelector('#msg-a-process-1 [data-testid="assistant-response-actions"]'),
    ).toBeNull();
    expect(
      container.querySelector('#msg-a-process-2 [data-testid="assistant-response-actions"]'),
    ).toBeNull();
    expect(
      container.querySelector('#msg-a-final [data-testid="assistant-response-actions"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('#msg-a-final [data-testid="response-copy-btn"]'),
    ).not.toBeNull();
  });

  it('does not treat a still-running last tool-loop row as a reply', () => {
    const processCaption = '接着核对中间轮次的操作栏。';
    render(
      [
        userMessage('u1', '查一下'),
        assistant({
          id: 'a-live',
          text: processCaption,
          thinking: 'Need another read.',
          tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: 'ok' }],
        }),
      ],
      { isConversationSession: true, onBranchResend: vi.fn(), onForkFromMessage: vi.fn() },
    );

    expect(container.querySelector('#msg-a-live .markdown')).toBeNull();
    expect(container.textContent).not.toContain(processCaption);
    expect(
      container.querySelector('#msg-a-live [data-testid="assistant-response-actions"]'),
    ).toBeNull();
  });

  it('keeps Project tool-loop captions out of the expanded work disclosure', () => {
    const processCaption = '同一轮被拆成多条 assistant 行。我去看 chat-thread 怎么画。';
    render(
      [
        userMessage('u1', 'Implement this.'),
        assistant({
          id: 'work-1',
          text: processCaption,
          thinking: 'Inspecting the implementation.',
          tools: [
            {
              toolCallId: 'read-1',
              toolName: 'read',
              status: 'done',
              output: 'source',
              runId: 'run-1',
            },
          ],
        }),
        assistant({
          id: 'answer-1',
          text: 'Implemented and verified.',
        }),
      ],
      {
        workDetailsExpanded: 'always',
        runRecordsById: {
          'run-1': {
            runId: 'run-1',
            phaseHistory: [],
            startedAt: 1_000,
            endedAt: 95_000,
            outcome: 'completed',
          },
        },
      },
    );

    expect(container.querySelector('#msg-work-1')).not.toBeNull();
    expect(container.querySelector('#msg-work-1 .markdown')).toBeNull();
    expect(container.textContent).not.toContain(processCaption);
    expect(container.querySelector('#msg-answer-1 .markdown')?.textContent).toContain(
      'Implemented and verified.',
    );
  });
});
