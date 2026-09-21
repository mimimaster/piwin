import { Fragment, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import type { ModelRef, ThemeManifest } from '@piwin/contracts';
import type { ChatMessageUi, ChatUiState } from './chat-reducer.js';
import { CompactionActivity } from './compaction-activity.js';
import { ConversationResponseContent } from './conversation-response-content.js';
import { UserMessageContent } from './conversation-user-message.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';
import { isQueuedTurnHiddenFromTranscript } from './queued-turn-visibility.js';
import { RunStatusFooter } from './run-status-footer.js';

export type ConversationPaneTranscriptProps = {
  sessionId: string;
  state: ChatUiState;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactInlineEnabled: boolean;
  /** Canvas capability. Omitted → follows the Inline value. */
  artifactCanvasEnabled?: boolean;
  locale: 'zh-CN' | 'en';
  livePromptModel?: ModelRef | null;
  onOpenDocument?: (doc: DocumentOpenInput) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
  onCompactAbort?: () => void | Promise<void>;
  onCancelGeneration?: () => void;
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

/** Within this distance of the bottom the pane keeps following new output. */
export const CONVERSATION_PANE_FOLLOW_THRESHOLD_PX = 48;

export function ConversationPaneTranscript(props: ConversationPaneTranscriptProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Follow the tail only while the reader is already there. Scrolling up to
  // read history during a stream must not be yanked back on every token.
  const followingRef = useRef(true);
  const messages = useMemo(() => {
    const visible = props.state.messages.filter((message) => {
      if (
        message.role !== 'user' &&
        message.role !== 'assistant' &&
        message.role !== 'system'
      ) {
        return false;
      }
      return !isQueuedTurnHiddenFromTranscript(message);
    });
    const tail = visible.at(-1);
    const priorLiveCallChain = visible.some(
      (message) =>
        message.role === 'assistant' &&
        message.tools.some((tool) => tool.status === 'running'),
    );
    return props.state.streaming && tail?.role === 'user' && !priorLiveCallChain
      ? [...visible, createPendingAssistant(tail, props.livePromptModel)]
      : visible;
  }, [props.livePromptModel, props.state.messages, props.state.streaming]);

  // Messages from the newest user row on: the turn the status footer measures.
  const currentTurnMessages = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return messages.slice(i);
    }
    return messages;
  }, [messages]);
  const showRunStatusFooter =
    props.state.streaming &&
    !props.state.awaitingTranscript &&
    !props.state.permissionPrompt &&
    !props.state.compactionActivity;

  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant') {
        return msg.id;
      }
    }
    return null;
  }, [messages]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !followingRef.current) return;
    // Scroll this pane only: scrollIntoView also moved ancestor scrollers and
    // stopped short of the transcript's bottom padding.
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="conversation-pane-transcript"
      onScroll={(event) => {
        const element = event.currentTarget;
        followingRef.current =
          element.scrollHeight - element.clientHeight - element.scrollTop <=
          CONVERSATION_PANE_FOLLOW_THRESHOLD_PX;
      }}
      role="log"
      aria-live="polite"
      aria-label={props.locale === 'zh-CN' ? 'Chat 消息' : 'Chat messages'}
      data-testid="conversation-pane-transcript"
      data-artifact-layout-root="main"
      data-artifact-layout-session={props.sessionId}
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
          const userRow = (
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
          return (
            <Fragment key={message.id}>
              {userRow}
              {props.state.compactionActivity?.anchorMessageId === message.id ? (
                <CompactionActivity
                  activity={props.state.compactionActivity}
                  locale={props.locale}
                  {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
                />
              ) : null}
            </Fragment>
          );
        }
        if (message.role === 'assistant') {
          // A transcript row can remain marked streaming after a terminal push
          // is missed. The pane's Host-backed run projection is the source of
          // truth for live chrome; otherwise a historical row can keep the
          // spinner and suppress its settled identity forever.
          const isLiveMessage = props.state.streaming && message.status === 'streaming';
          const previous = messages[messageIndex - 1];
          const showHeader = previous?.role !== 'assistant';
          const assistantRow = (
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
                artifactInlineEnabled={props.artifactInlineEnabled}
                artifactCanvasEnabled={props.artifactCanvasEnabled ?? props.artifactInlineEnabled}
                runRecordsById={props.state.runRecordsById}
                activeRunId={props.state.activeRunId}
                locale={props.locale}
                showHeader={showHeader}
                renderMediaChrome
                {...(props.livePromptModel !== undefined
                  ? { livePromptModel: props.livePromptModel }
                  : {})}
                isLatestAssistantResponse={latestAssistantId === message.id}
                isStreaming={isLiveMessage}
                {...(isLiveMessage && props.onCancelGeneration
                  ? { onCancelGeneration: props.onCancelGeneration }
                  : {})}
                {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                {...(props.onOpenArtifactCanvas
                  ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                  : {})}
                {...(props.fileBrowseRoot ? { projectPath: props.fileBrowseRoot } : {})}
              />
            </div>
          );
          return (
            <Fragment key={message.id}>
              {assistantRow}
              {props.state.compactionActivity?.anchorMessageId === message.id ? (
                <CompactionActivity
                  activity={props.state.compactionActivity}
                  locale={props.locale}
                  {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
                />
              ) : null}
            </Fragment>
          );
        }
        return (
          <div key={message.id} className="conversation-pane-system-message muted">
            {message.text}
          </div>
        );
      })}
      {props.state.compactionActivity &&
      !messages.some((message) => message.id === props.state.compactionActivity?.anchorMessageId) ? (
        <CompactionActivity
          activity={props.state.compactionActivity}
          locale={props.locale}
          {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
        />
      ) : null}
      {showRunStatusFooter ? (
        <RunStatusFooter
          messages={currentTurnMessages}
          activeRunId={props.state.activeRunId}
          runRecordsById={props.state.runRecordsById}
          modelWaitTail={null}
          locale={props.locale}
          {...(props.state.activeSkill ? { skill: props.state.activeSkill } : {})}
        />
      ) : null}
    </div>
  );
}
