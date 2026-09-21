// @vitest-environment happy-dom
/**
 * One bad message must not blank the conversation: the transcript contains a
 * throwing row locally instead of letting it reach the shell boundary.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi } from './chat-reducer';
import { ChatThread, type ChatThreadProps } from './chat-thread';
import type { ChatMessageRowProps } from './chat-message-row-types';
import type { ComposerDockProps } from './composer-dock';

vi.mock('./chat-message-row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chat-message-row')>();
  return {
    ...actual,
    ChatMessageRow: (props: ChatMessageRowProps): ReactElement | null => {
      if (props.message.id === 'a-boom') {
        throw new Error('message row exploded mid-stream');
      }
      // The real export is a memo() object, so it can only be rendered.
      return createElement(actual.ChatMessageRow, props);
    },
  };
});

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

function assistantMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'run-1',
  };
}

describe('ChatThread render containment', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleError.mockRestore();
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
          artifactInlineEnabled
          {...extras}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(node);
    });
  }

  it('keeps sibling messages when one row throws', () => {
    render(
      [
        userMessage('u1', '让鹈鹕骑上自行车'),
        assistantMessage('a-boom', '这段会在渲染时炸掉。'),
        assistantMessage('a-ok', '这条必须照常渲染。'),
      ],
      { workDetailsExpanded: 'always' },
    );

    const fallback = container.querySelector(
      '[data-testid="render-error-boundary"][data-surface="message"]',
    );
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('message row exploded mid-stream');

    // The rest of the transcript still rendered.
    expect(container.querySelector('#msg-a-ok .markdown')?.textContent).toContain(
      '这条必须照常渲染。',
    );
    expect(container.querySelector('#msg-u1')).not.toBeNull();
  });

  it('renders the healthy transcript with no boundary node when nothing throws', () => {
    render(
      [userMessage('u1', '不加画布的普通回复'), assistantMessage('a-ok', '一切正常。')],
      { workDetailsExpanded: 'always' },
    );

    expect(
      container.querySelector('[data-testid="render-error-boundary"]'),
    ).toBeNull();
    expect(container.querySelector('#msg-a-ok .markdown')?.textContent).toContain('一切正常。');
  });
});
