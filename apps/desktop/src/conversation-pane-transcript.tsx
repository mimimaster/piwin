import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { ModelRef, ThemeManifest } from '@piwin/contracts';
import type { ChatMessageUi, ChatUiState } from './chat-reducer.js';
import { ConversationResponseContent } from './conversation-response-content.js';
import { UserMessageContent } from './conversation-user-message.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export type ConversationPaneTranscriptProps = {
  sessionId: string;
  state: ChatUiState;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactPreviewEnabled: boolean;
  locale: 'zh-CN' | 'en';
  livePromptModel?: ModelRef | null;
  onOpenDocument?: (doc: DocumentOpenInput) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
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

  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant') {
        return msg.id;
      }
    }
    return null;
  }, [messages]);

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
          // A transcript row can remain marked streaming after a terminal push
          // is missed. The pane's Host-backed run projection is the source of
          // truth for live chrome; otherwise a historical row can keep the
          // spinner and suppress its settled identity forever.
          const isLiveMessage = props.state.streaming && message.status === 'streaming';
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
                showStreamingCaret={isLiveMessage && message.text.length > 0}
                activeTheme={props.activeTheme}
                artifactThemeKey={props.artifactThemeKey}
                artifactPreviewEnabled={props.artifactPreviewEnabled}
                runRecordsById={props.state.runRecordsById}
                activeRunId={props.state.activeRunId}
                locale={props.locale}
                {...(props.livePromptModel !== undefined
                  ? { livePromptModel: props.livePromptModel }
                  : {})}
                isLatestAssistantResponse={latestAssistantId === message.id}
                isStreaming={isLiveMessage}
                {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                {...(props.onOpenArtifactCanvas
                  ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                  : {})}
                {...(props.fileBrowseRoot ? { projectPath: props.fileBrowseRoot } : {})}
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
