/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { ChatMessageUi } from './chat-reducer';

import {
  GoalActionsProvider,
  type GoalActions,
} from './goal';
import { focusComposerInput } from './context-menu/desktop-context-menu-value';
import { TranscriptTurnList } from './transcript-turn-list';
import { useStableTranscriptTurns } from './use-stable-transcript-turns';
import { buildExploreFlowRoles } from './explore-flow';
import { collectMessageChangedFiles } from './collect-message-changed-files';
import { findStreamingCaretMessageId } from './streaming-caret';
import { DocCardSequenceView } from './DocCardSequenceView';
import {
  type WorkDisclosureOverride,
} from './turn-work-disclosure-open-state.js';
import { useTurnWorkSegmentState } from './use-turn-work-segment-state.js';
import { CompactionActivity } from './compaction-activity.js';
import { isCompactionRunning } from './compaction-seam-model.js';
import { isQueuedTurnHiddenFromTranscript } from './queued-turn-visibility.js';
import { RunStatusFooter } from './run-status-footer.js';
import { TranscriptSelectionToolbar } from './transcript-selection-toolbar.js';
import { renderChatTurn } from './chat-turn-renderer.js';

export type { ChatThreadProps } from './chat-thread-types.js';
import type { ChatThreadProps } from './chat-thread-types.js';

export function ChatThread(props: ChatThreadProps): ReactElement {
  // Quiet workbench: msg-in only for messages that arrive after first mount
  // (history hydrate must not replay entrance animation).
  const knownIdsRef = useRef<Set<string> | null>(null);
  const isInitialMountRef = useRef(true);
  const knownSessionRef = useRef(props.sessionId ?? 'none');
  const sessionKey = props.sessionId ?? 'none';
  if (knownIdsRef.current === null || knownSessionRef.current !== sessionKey || props.hydrating) {
    knownSessionRef.current = sessionKey;
    knownIdsRef.current = new Set(props.messages.map((message) => message.id));
    isInitialMountRef.current = true;
  }
  const enteringIds = new Set<string>();
  if (!isInitialMountRef.current) {
    for (const message of props.messages) {
      if (!knownIdsRef.current.has(message.id)) {
        enteringIds.add(message.id);
      }
    }
  }
  useEffect(() => {
    isInitialMountRef.current = false;
    const known = knownIdsRef.current ?? new Set<string>();
    for (const message of props.messages) {
      known.add(message.id);
    }
    knownIdsRef.current = known;
  }, [props.messages]);

  // A pending/starting queued turn already has a dedicated Host-owned queue
  // row above the composer. Keep its durable transcript row in state for
  // reload/reconciliation, but do not render the same text as a second chat
  // bubble until the Host has actually started the turn.
  const transcriptMessages = useMemo(
    () =>
      props.messages.filter((message) => !isQueuedTurnHiddenFromTranscript(message)),
    [props.messages],
  );
  const effectiveMessages = useMemo(() => {
    if (!props.isConversationSession || !props.streaming) {
      return transcriptMessages;
    }
    const tail = transcriptMessages[transcriptMessages.length - 1];
    if (tail?.role === 'user') {
      const pendingAssistantMessage: ChatMessageUi = {
        id: `pending-assistant-${tail.id}`,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'streaming',
        createdAt: new Date().toISOString(),
        ...(props.livePromptModel ? { model: props.livePromptModel } : {}),
      };
      return [...transcriptMessages, pendingAssistantMessage];
    }
    return transcriptMessages;
  }, [props.isConversationSession, props.streaming, props.livePromptModel, transcriptMessages]);
  const docCardSequence = useMemo(
    () => effectiveMessages.find((message) => message.docCardSequence)?.docCardSequence,
    [effectiveMessages],
  );
  const chatMessages = useMemo(
    () =>
      docCardSequence
        ? effectiveMessages.filter((message) => !message.docCardSequence)
        : effectiveMessages,
    [docCardSequence, effectiveMessages],
  );

  const turnGroups = useStableTranscriptTurns(chatMessages);
  const [workDisclosureOpenByTurnId, setWorkDisclosureOpenByTurnId] = useState<
    Record<string, WorkDisclosureOverride>
  >({});
  const segmentState = useTurnWorkSegmentState();
  // Cursor-style explore flow: consecutive read/search/thought-only assistant
  // steps collapse into one "Explored N files" capsule anchored at the first
  // step (agent sessions only — conversation mode keeps per-reply chrome).
  const exploreRolesByMessageId = useMemo(
    () =>
      props.isConversationSession === true
        ? new Map()
        : buildExploreFlowRoles(chatMessages, { streamActive: props.streaming === true }),
    [chatMessages, props.isConversationSession, props.streaming],
  );
  // Messages whose tools already render inside an explore capsule. The
  // turn-level fold skips a chain that group has covered on its own.
  const exploreFoldedMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [messageId, role] of exploreRolesByMessageId) {
      if (role.kind === 'anchor' || role.kind === 'member') ids.add(messageId);
    }
    return ids;
  }, [exploreRolesByMessageId]);
  const precedingUser = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg?.role === 'user') {
        return msg;
      }
    }
    return undefined;
  }, [chatMessages]);
  const currentResponseTurnId = turnGroups[turnGroups.length - 1]?.id ?? null;
  const compactionActivityTurnId = useMemo(() => {
    const activity = props.compactionActivity;
    if (!activity) {
      return null;
    }
    if (activity.anchorMessageId) {
      const anchoredTurn = turnGroups.find((turn) =>
        turn.items.some((item) => item.message.id === activity.anchorMessageId),
      );
      if (anchoredTurn) {
        return anchoredTurn.id;
      }
    }
    return currentResponseTurnId;
  }, [currentResponseTurnId, props.compactionActivity, turnGroups]);
  const conversationSession = props.isConversationSession === true;
  // A run accepted before its user row lands has no turn to foot yet.
  const pendingRunStatusFooter =
    props.streaming === true &&
    !props.permissionPrompt &&
    !isCompactionRunning(props.compactionActivity) &&
    chatMessages.length === 0;
  const changedFilePathsByTurnId = useMemo(() => {
    const pathsByTurnId = new Map<string, string[]>();
    for (const turn of turnGroups) {
      const paths = new Set<string>();
      for (const item of turn.items) {
        for (const file of collectMessageChangedFiles(item.message.tools ?? [])) {
          paths.add(file.path);
        }
      }
      pathsByTurnId.set(turn.id, Array.from(paths));
    }
    return pathsByTurnId;
  }, [turnGroups]);

  // Find the single assistant message that should show the streaming caret.
  const streamingCaretMessageId = useMemo(() => {
    if (!props.streaming) return null;
    return findStreamingCaretMessageId(
      chatMessages,
      props.runRecordsById ?? {},
      props.activeRunId ?? null,
    );
  }, [chatMessages, props.activeRunId, props.runRecordsById, props.streaming]);

  // Goal cards sit several levels down the transcript; their actions travel by
  // context rather than through every intermediate component's props.
  const onAgentModeChange = props.composerCard.onAgentModeChange;
  const onReviewChanges = props.onReviewChanges;
  const goalActions = useMemo<GoalActions>(
    () => ({
      focusComposer: () => focusComposerInput(),
      leaveGoalMode: () => onAgentModeChange('agent'),
      ...(onReviewChanges ? { reviewChanges: onReviewChanges } : {}),
    }),
    [onAgentModeChange, onReviewChanges],
  );

  // SF-04: The newest completed assistant response gets the lineage tree in its action row.
  const latestAssistantMessageId = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg && msg.role === 'assistant') {
        return msg.id;
      }
    }
    return null;
  }, [chatMessages]);

  const threadRef = useRef<HTMLDivElement>(null);

  return (
    <GoalActionsProvider actions={goalActions}>
    <div
      ref={threadRef}
      className={`chat-thread${conversationSession ? ' is-conversation' : ''}`}
      data-testid="chat-thread"
    >
      {docCardSequence && props.docCardRequest ? (
        <div className="chat-doc-card-sequence-slot">
          <DocCardSequenceView sequence={docCardSequence} request={props.docCardRequest} />
        </div>
      ) : null}
      <TranscriptTurnList
        turns={turnGroups}
        pinnedMessageId={props.editingMessageId}
        streaming={props.streaming === true}
        renderTurn={(turn) =>
          renderChatTurn({
            turn,
            props,
            conversationSession,
            currentResponseTurnId,
            compactionActivityTurnId,
            latestAssistantMessageId,
            precedingUser,
            streamingCaretMessageId,
            exploreRolesByMessageId,
            exploreFoldedMessageIds,
            workDisclosureOpenByTurnId,
            setWorkDisclosureOpenByTurnId,
            segmentState,
            enteringIds,
            changedFilePathsByTurnId,
          })
        }
      />
      {currentResponseTurnId === null &&
      (pendingRunStatusFooter || props.compactionActivity) ? (
        <section
          className="chat-turn-group is-current-response"
          data-testid="current-response-turn"
        >
          {props.compactionActivity ? (
            <CompactionActivity
              activity={props.compactionActivity}
              locale={props.locale ?? 'zh-CN'}
              {...(props.onCompactAbort ? { onAbort: props.onCompactAbort } : {})}
            />
          ) : null}
          {pendingRunStatusFooter ? (
            <RunStatusFooter
              messages={[]}
              activeRunId={props.activeRunId ?? null}
              runRecordsById={props.runRecordsById ?? {}}
              modelWaitTail={null}
              locale={props.locale ?? 'zh-CN'}
              {...(props.agentLocatorAnimation ? { animation: props.agentLocatorAnimation } : {})}
              {...(props.activeSkill ? { skill: props.activeSkill } : {})}
            />
          ) : null}
        </section>
      ) : null}
      <TranscriptSelectionToolbar
        containerRef={threadRef}
        projectPath={props.projectPath}
        locale={props.locale}
      />
      </div>
    </GoalActionsProvider>
  );
}
