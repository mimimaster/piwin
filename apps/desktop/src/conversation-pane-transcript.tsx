import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { ModelRef, ThemeManifest } from '@piwin/contracts';
import type { ChatMessageUi, ChatUiState } from './chat-reducer.js';
import { ConversationResponseContent } from './conversation-response-content.js';
import { UserMessageContent } from './conversation-user-message.js';

export type ConversationPaneTranscriptProps = {
  sessionId: string;
  state: ChatUiState;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  locale: 'zh-CN' | 'en';
  livePromptModel?: ModelRef | null;
};

function createPendingAssistant(
  userMessage: ChatMessageUi,
  model: ModelRef | null | undefined,
): ChatMessageUi {
  return {
    id: `pane-pending-assistant-${userMessage.id}`,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'streaming',
    createdAt: new Date().toISOString(),
    ...(model ? { model } : {}),
  };
}

export function ConversationPaneTranscript(props: ConversationPaneTranscriptProps): ReactElement {
  const endRef = useRef<HTMLDivElement | null>(null);
  const messages = useMemo(() => {
    const visible = props.state.messages.filter(
      (message) =>
        message.role === 'user' || message.role === 'assistant' || message.role === 'system',
    );
    const tail = visible.at(-1);
    return props.state.streaming && tail?.role === 'user'
      ? [...visible, createPendingAssistant(tail, props.livePromptModel)]
      : visible;
  }, [props.livePromptModel, props.state.messages, props.state.streaming]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div
      className="conversation-pane-transcript"
      role="log"
      aria-live="polite"
      aria-label={props.locale === 'zh-CN' ? 'Chat 消息' : 'Chat messages'}
      data-testid="conversation-pane-transcript"
    >
      {props.state.awaitingTranscript ? (
        <div className="conversation-pane-loading" role="status">
          {props.locale === 'zh-CN' ? '正在加载会话…' : 'Loading conversation…'}
        </div>
      ) : null}
      {messages.length === 0 && !props.state.awaitingTranscript ? (
        <div className="conversation-pane-empty-copy muted">
          {props.locale === 'zh-CN' ? '开始一段新的对话。' : 'Start a new conversation.'}
        </div>
      ) : null}
      {messages.map((message, messageIndex) => {
        if (message.role === 'user') {
          return (
            <div
              key={message.id}
              className="conversation-pane-message role-user"
              data-message-id={message.id}
            >
              <UserMessageContent
                message={message}
                streaming={props.state.streaming}
                locale={props.locale}
                isConversationSession
              />
            </div>
          );
        }
        if (message.role === 'assistant') {
          return (
            <div
              key={message.id}
              className="conversation-pane-message role-assistant"
              data-message-id={message.id}
            >
              <ConversationResponseContent
                message={message}
                sessionId={props.sessionId}
                messageIndex={messageIndex}
                showStreamingCaret={message.status === 'streaming' && message.text.length > 0}
                activeTheme={props.activeTheme}
                artifactThemeKey={props.artifactThemeKey}
                runRecordsById={props.state.runRecordsById}
                activeRunId={props.state.activeRunId}
                locale={props.locale}
                {...(props.livePromptModel !== undefined
                  ? { livePromptModel: props.livePromptModel }
                  : {})}
                isStreaming={message.status === 'streaming'}
              />
            </div>
          );
        }
        return (
          <div key={message.id} className="conversation-pane-system-message muted">
            {message.text}
          </div>
        );
      })}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
