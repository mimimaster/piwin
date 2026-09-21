// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const toolboxSearch: ChatMessageUi['tools'][number] = {
  toolCallId: 'tb-1',
  toolName: 'piwin_toolbox',
  status: 'done',
  output: JSON.stringify({ tools: [{ id: 'flashcard_create' }, { id: 'library_search' }] }),
  presentation: {
    kind: 'mcp',
    title: 'Tool catalog',
    actionVerb: 'Tool discovery',
    summary: 'library',
    inputPreview: '{"query":"library","action":"search"}',
  },
};

describe('ChatThread model wait tail', () => {
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

  function render(messages: ChatMessageUi[], phase: string, extras: Partial<ChatThreadProps> = {}): void {
    const node: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ChatThread
          messages={messages}
          streaming
          editingMessageId={null}
          lastUserMessageId="u1"
          activeTheme={null}
          artifactThemeKey={0}
          activeRunId="run-1"
          runRecordsById={{
            'run-1': {
              runId: 'run-1',
              phaseHistory: [
                {
                  phase: phase as NonNullable<ChatThreadProps['runRecordsById']>[string]['phaseHistory'][number]['phase'],
                  at: Date.now() - 12_000,
                },
              ],
              startedAt: Date.now() - 60_000,
              endedAt: null,
            },
          }}
          onEdit={noop}
          onCancelEdit={noop}
          onEditResend={noop}
          onRetry={noop}
          onInspectSubagent={undefined}
          composerCard={composerCard}
          locale="zh-CN"
          artifactInlineEnabled
          {...extras}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(node);
    });
  }

  it('moves the run status footer to the model-wait phrase after a settled tool round', () => {
    render(
      [
        userMessage('u1', '资料库默认设置'),
        assistant({
          id: 'a1',
          model: { providerId: 'google', modelId: 'gemini-3.8-flash' },
          tools: [toolboxSearch],
        }),
        assistant({ id: 'a2', status: 'streaming' }),
      ],
      'waiting-first-token',
    );

    const footers = container.querySelectorAll('[data-testid="run-status-footer"]');
    expect(footers).toHaveLength(1);
    expect(footers[0]?.querySelector('[data-testid="agent-locator"]')?.getAttribute('data-kind')).toBe(
      'waiting-first-token',
    );
    // Clock counts from run start, not from the wait.
    expect(footers[0]?.querySelector('[data-testid="agent-locator-meta"]')?.textContent).toContain('1m 00s');
    expect(container.textContent).not.toContain('正在运行');
    // The empty message/start bubble must not paint a second locator.
    expect(container.querySelector('#msg-a2')).toBeNull();
    expect(container.querySelectorAll('[data-testid="agent-locator"]')).toHaveLength(1);

    const row = container.querySelector('[data-toolbox-action="search"]');
    expect(row?.textContent).toContain('查找可用工具');
    expect(row?.textContent).toContain('library');
    expect(row?.textContent).toContain('找到 2 个');
    expect(row?.textContent).not.toContain('{');
  });

  it('keeps live tokens on the footer and holds the reply colophon until the run ends', () => {
    const messages = [
      userMessage('u1', '资料库默认设置'),
      assistant({ id: 'a1', text: 'x'.repeat(8_000), tools: [toolboxSearch] }),
    ];
    render(messages, 'tool-running');

    const meta = container.querySelector('[data-testid="agent-locator-meta"]');
    expect(meta?.textContent).toMatch(/1m 00s.*2(\.\d)?k tokens/);
    expect(container.querySelector('[data-testid="assistant-response-actions"]')).toBeNull();

    render(messages, 'tool-running', { streaming: false, activeRunId: null });
    expect(container.querySelector('[data-testid="run-status-footer"]')).toBeNull();
    expect(container.querySelector('[data-testid="assistant-response-actions"]')).not.toBeNull();
  });

  it('shows the streaming bubble again once the model writes, under the same footer', () => {
    render(
      [
        userMessage('u1', '资料库默认设置'),
        assistant({ id: 'a1', tools: [toolboxSearch] }),
        assistant({ id: 'a2', status: 'streaming', text: '好的' }),
      ],
      'streaming',
    );
    expect(container.querySelector('#msg-a2')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="run-status-footer"]')).toHaveLength(1);
  });
});
