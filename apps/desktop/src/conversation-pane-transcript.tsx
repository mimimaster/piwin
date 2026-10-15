/**
 * Transcript of a conversation pane (split pane, dock view, right-panel side
 * chat). The rows are the main workbench's `ChatThread` — same turn grouping,
 * explore folding, work disclosure and placeholder rules — so a pane never
 * drifts from the main conversation's rendering. This component only owns the
 * pane's scroll viewport and its follow-tail behaviour.
 *
 * Session actions the pane cannot perform (in-place edit / retry, forks,
 * walkthroughs, subagent inspector) are simply not passed; ChatThread hides
 * their affordances when the handler is absent.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import type { ChatUiState } from './chat-reducer.js';
import { ChatThread } from './chat-thread.js';
import type { ComposerDockProps } from './composer-dock-types.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';
import { memoWithLatestCallbacks } from './memo-with-latest-callbacks.js';
import { activeSessionPermissionPrompt } from './permission-queue.js';
import { useTranscriptComposerCard } from './transcript-composer-card.js';
import { loadDesktopPreferences } from './ui-preferences.js';

export type ConversationPaneTranscriptProps = {
  sessionId: string;
  state: ChatUiState;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactInlineEnabled: boolean;
  /** Canvas capability. Omitted → follows the Inline value. */
  artifactCanvasEnabled?: boolean;
  locale: 'zh-CN' | 'en';
  /**
   * General-scope Chat session: conversation chrome. Project sessions keep the
   * Agent presentation (explore capsules, work disclosure), like the main view.
   */
  isConversationSession: boolean;
  /** The pane's composer; the in-place edit card and goal actions read it. */
  composerCard: ComposerDockProps;
  onOpenDocument?: (doc: DocumentOpenInput) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
  onCompactAbort?: () => void | Promise<void>;
};

/** Within this distance of the bottom the pane keeps following new output. */
export const CONVERSATION_PANE_FOLLOW_THRESHOLD_PX = 48;

/** Streaming re-renders the pane per token; settled rows must not follow. */
const StableChatThread = memoWithLatestCallbacks(ChatThread);

export function ConversationPaneTranscript(props: ConversationPaneTranscriptProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Follow the tail only while the reader is already there. Scrolling up to
  // read history during a stream must not be yanked back on every token.
  const followingRef = useRef(true);
  // Panes are not wired to the workbench preference state; read the persisted
  // display preferences once so tool density / thinking match the main view.
  const [preferences] = useState(loadDesktopPreferences);
  const composerCard = useTranscriptComposerCard(props.composerCard);
  const { state } = props;

  const lastUserMessageId = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const message = state.messages[i];
      if (message?.role === 'user') return message.id;
    }
    return null;
  }, [state.messages]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !followingRef.current) return;
    // Scroll this pane only: scrollIntoView also moved ancestor scrollers and
    // stopped short of the transcript's bottom padding.
    element.scrollTop = element.scrollHeight;
  }, [state.messages, state.streaming]);

  const showThread = state.messages.length > 0 || state.streaming;

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
      {state.awaitingTranscript ? (
        <div className="conversation-pane-loading" role="status">
          {props.locale === 'zh-CN' ? '正在加载会话…' : 'Loading conversation…'}
        </div>
      ) : null}
      {!showThread && !state.awaitingTranscript ? (
        <div className="conversation-pane-empty-copy muted">
          {props.locale === 'zh-CN' ? '开始一段新的对话。' : 'Start a new conversation.'}
        </div>
      ) : null}
      {showThread ? (
        <StableChatThread
          messages={state.messages}
          sessionId={props.sessionId}
          hydrating={state.awaitingTranscript}
          streaming={state.streaming}
          isConversationSession={props.isConversationSession}
          livePromptModel={state.pendingTurnModel}
          contextUsage={state.contextUsage}
          editingMessageId={null}
          lastUserMessageId={lastUserMessageId}
          activeTheme={props.activeTheme}
          artifactThemeKey={props.artifactThemeKey}
          artifactInlineEnabled={props.artifactInlineEnabled}
          artifactCanvasEnabled={props.artifactCanvasEnabled ?? props.artifactInlineEnabled}
          artifactCodeFirst={preferences.artifactCodeFirst}
          runRecordsById={state.runRecordsById}
          activeRunId={state.activeRunId}
          activeSkill={state.activeSkill}
          permissionPrompt={activeSessionPermissionPrompt(state)}
          projectPath={props.fileBrowseRoot ?? null}
          workDetailsExpanded={preferences.workDetailsExpanded}
          toolDensity={preferences.toolDensity}
          showThinking={preferences.verboseAgentChat}
          {...(preferences.agentLocatorAnimation
            ? { agentLocatorAnimation: preferences.agentLocatorAnimation }
            : {})}
          locale={props.locale}
          onInspectSubagent={undefined}
          subagentChildren={state.subagentChildren}
          subagentInvocations={state.subagentInvocations}
          subagentStreams={state.subagentStreams}
          compactionActivity={state.compactionActivity}
          {...(props.onCompactAbort ? { onCompactAbort: props.onCompactAbort } : {})}
          composerCard={composerCard}
          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
          {...(props.onOpenArtifactCanvas
            ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
            : {})}
        />
      ) : null}
    </div>
  );
}
