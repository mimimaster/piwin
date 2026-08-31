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

  it('folds Conversation process markdown after the conclusion and keeps actions on the reply', () => {
    const processBody = '空框就是中间轮次挂上的复制/再生成栏。接下来只在最后一条保留操作栏。';
    const finalText = '一只大嘴鹈鹕在海岸公路上骑复古自行车。';
    render(
      [
        userMessage('u1', '为什么会话会断裂'),
        assistant({
          id: 'a-process-1',
          text: processBody,
          thinking: 'Inspect the conversation chrome.',
          tools: [
            { toolCallId: 't1', toolName: 'read', status: 'done', output: 'ok' },
            { toolCallId: 't2', toolName: 'grep', status: 'done', output: 'ok' },
          ],
        }),
        assistant({
          id: 'a-process-2',
          text: processBody,
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

    expect(container.querySelector('#msg-a-process-1')).toBeNull();
    expect(container.querySelector('#msg-a-process-2')).toBeNull();
    expect(container.textContent).not.toContain(processBody);
    expect(container.querySelector('#msg-a-final .markdown')?.textContent).toContain(finalText);
    expect(
      container.querySelector('#msg-a-final [data-testid="assistant-response-actions"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('#msg-a-final [data-testid="response-copy-btn"]'),
    ).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="turn-work-disclosure-trigger"]')
        ?.click();
    });

    expect(container.querySelector('#msg-a-process-1 .markdown')?.textContent).toContain(processBody);
    expect(container.querySelector('#msg-a-process-2 .markdown')?.textContent).toContain(processBody);
    expect(
      container.querySelector('#msg-a-process-1 [data-testid="assistant-response-actions"]'),
    ).toBeNull();
    expect(
      container.querySelector('#msg-a-final [data-testid="response-copy-btn"]'),
    ).not.toBeNull();
  });

  it('keeps live process markdown visible before a conclusion arrives', () => {
    const processBody = '接着核对中间轮次的操作栏。';
    render(
      [
        userMessage('u1', '查一下'),
        assistant({
          id: 'a-live',
          text: processBody,
          thinking: 'Need another read.',
          tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: 'ok' }],
        }),
      ],
      { isConversationSession: true, onBranchResend: vi.fn(), onForkFromMessage: vi.fn() },
    );

    expect(container.querySelector('#msg-a-live .markdown')?.textContent).toContain(processBody);
    expect(container.querySelector('[data-testid="turn-work-disclosure"]')).toBeNull();
  });

  it('restores Project process markdown inside the expanded work disclosure', () => {
    const processBody = '同一轮被拆成多条 assistant 行。我去看 chat-thread 怎么画。';
    render(
      [
        userMessage('u1', 'Implement this.'),
        assistant({
          id: 'work-1',
          text: processBody,
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
    expect(container.querySelector('#msg-work-1 .markdown')?.textContent).toContain(processBody);
    expect(container.querySelector('#msg-answer-1 .markdown')?.textContent).toContain(
      'Implemented and verified.',
    );
  });
});
