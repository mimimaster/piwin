/**
 * Scrollable assistant/user message list with edit/retry actions.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type RefObject,
} from 'react';
import { ChatThreadResourceBoundary } from './chat-thread-resource-boundary.js';
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import {
  resolveFullFidelityTailCount,
  resolveLiveStaticTurnTailCap,
} from './settled-turn-diet.js';
import {
  alignTranscriptReadingAnchor,
  captureTranscriptReadingAnchor,
  type TranscriptReadingAnchor,
} from './transcript-reading-anchor.js';
import { useTranscriptScrollPort } from './transcript-scroll-port.js';

import type { ChatMessageUi } from './chat-reducer';

import {
  GoalActionsProvider,
  type GoalActions,
} from '../goal';
import { focusComposerInput } from '../context-menu/desktop-context-menu-value';
import { TranscriptTurnList } from './transcript-turn-list';
import { useStableTranscriptTurns } from '../hooks/use-stable-transcript-turns';
import type { TranscriptTurn } from './transcript-turns';
import { buildExploreFlowRolesByTurn } from './explore-flow';
import { collectMessageChangedFiles } from '../turn-changes/collect-message-changed-files';
import { findStreamingCaretMessageId } from './streaming-caret';
import { DocCardSequenceView } from '../documents/DocCardSequenceView';
import {
  type WorkDisclosureOverride,
} from '../turn-changes/turn-work-disclosure-open-state.js';
import { useTurnWorkSegmentState } from '../hooks/use-turn-work-segment-state.js';
import { CompactionActivity } from './compaction-activity.js';
import { isCompactionRunning } from './compaction-seam-model.js';
import { isInstructionRowHiddenFromTranscript } from './instruction-row-visibility.js';
import { RunStatusFooter } from '../run-activity/run-status-footer.js';
import { TranscriptSelectionToolbar } from './transcript-selection-toolbar.js';
import { ChatTurnView } from './chat-turn-view.js';
import { BackendWorkflowSequence } from '../agents/backend-workflows.js';
import { useBackendWorkflows } from '../hooks/use-backend-workflows.js';
import { groupBackendWorkflowsByTurn } from '../agents/backend-workflow-turns.js';
import type { BackendWorkflowSnapshot } from '@piwin/contracts';

const EMPTY_WORKFLOWS: readonly BackendWorkflowSnapshot[] = [];

/**
 * Keyed on the turn object: settled turns keep theirs across tokens
 * (useStableTranscriptTurns), so only the live turn rescans its tools.
 */
const changedFilePathsByTurn = new WeakMap<TranscriptTurn, readonly string[]>();

function changedFilePathsForTurn(turn: TranscriptTurn): readonly string[] {
  const cached = changedFilePathsByTurn.get(turn);
  if (cached !== undefined) return cached;
  const paths = new Set<string>();
  for (const item of turn.items) {
    for (const file of collectMessageChangedFiles(item.message.tools ?? [])) {
      paths.add(file.path);
    }
  }
  const result = Array.from(paths);
  changedFilePathsByTurn.set(turn, result);
  return result;
}

export type { ChatThreadProps } from './chat-thread-types.js';
import type { ChatThreadProps } from './chat-thread-types.js';

export function ChatThread(props: ChatThreadProps): ReactElement {
  return (
    <ChatThreadResourceBoundary sessionId={props.sessionId}>
      {(presentationRef) => <ChatThreadContent {...props} presentationRef={presentationRef} />}
    </ChatThreadResourceBoundary>
  );
}

function ChatThreadContent(props: ChatThreadProps & {
  presentationRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
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

  // Waiting queued turns (shown as a queue row above the composer) and
  // cancelled instructions stay in state for reload/reconciliation but are
  // not drawn as chat bubbles.
  const transcriptMessages = useMemo(
    () =>
      props.messages.filter((message) => !isInstructionRowHiddenFromTranscript(message)),
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
  const workflowObservation = useBackendWorkflows(props.sessionId, props.workflowRequest);
  const workflowTurns = useMemo(() => groupBackendWorkflowsByTurn(
    turnGroups, workflowObservation.data?.workflows ?? [],
  ), [turnGroups, workflowObservation.data]);
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
        : buildExploreFlowRolesByTurn(turnGroups, { streamActive: props.streaming === true }),
    [turnGroups, props.isConversationSession, props.streaming],
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
    const pathsByTurnId = new Map<string, readonly string[]>();
    for (const turn of turnGroups) {
      pathsByTurnId.set(turn.id, changedFilePathsForTurn(turn));
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

  const scrollPort = useTranscriptScrollPort();
  const pressureLevel = useSyncExternalStore(
    globalMemoryGovernor.subscribe,
    globalMemoryGovernor.getLevel,
    globalMemoryGovernor.getLevel,
  );
  const lastTurnId = turnGroups.at(-1)?.id ?? null;
  const tailStateSnapshot = {
    sessionId: props.sessionId ?? null,
    lastUserMessageId: props.lastUserMessageId,
    lastTurnId,
    historyViewActive: Boolean(props.historyViewActive),
  };
  const [prevTailState, setPrevTailState] = useState(tailStateSnapshot);
  const [extraRevealedTurns, setExtraRevealedTurns] = useState(0);
  const switchedSession = prevTailState.sessionId !== tailStateSnapshot.sessionId;
  const returnedToLive = prevTailState.historyViewActive && !tailStateSnapshot.historyViewActive;
  const newTailPrompt =
    prevTailState.lastUserMessageId !== tailStateSnapshot.lastUserMessageId &&
    prevTailState.lastTurnId !== tailStateSnapshot.lastTurnId &&
    tailStateSnapshot.lastUserMessageId !== null;
  if (
    switchedSession ||
    prevTailState.historyViewActive !== tailStateSnapshot.historyViewActive ||
    newTailPrompt
  ) {
    setPrevTailState(tailStateSnapshot);
    if (switchedSession || returnedToLive || newTailPrompt) {
      setExtraRevealedTurns(0);
    }
  }

  const tailCap = resolveLiveStaticTurnTailCap(pressureLevel);
  const rawTailStart =
    props.historyViewActive || turnGroups.length <= tailCap + extraRevealedTurns
      ? 0
      : Math.max(0, turnGroups.length - (tailCap + extraRevealedTurns));
  const editTurnIndex = props.editingMessageId
    ? turnGroups.findIndex((turn) =>
        turn.items.some((item) => item.message.id === props.editingMessageId),
      )
    : -1;
  const tailStartIndex =
    editTurnIndex >= 0 && editTurnIndex < rawTailStart ? editTurnIndex : rawTailStart;
  const hiddenResidentTurnCount = tailStartIndex;
  const visibleTurnGroups = useMemo(
    () => (tailStartIndex > 0 ? turnGroups.slice(tailStartIndex) : turnGroups),
    [tailStartIndex, turnGroups],
  );
  const turnIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (let index = 0; index < turnGroups.length; index += 1) {
      const turn = turnGroups[index];
      if (turn) map.set(turn.id, index);
    }
    return map;
  }, [turnGroups]);
  const fullFidelityTailCount = resolveFullFidelityTailCount(pressureLevel);

  const pendingPrependAnchorRef = useRef<TranscriptReadingAnchor | null>(null);
  const hiddenResidentRef = useRef(hiddenResidentTurnCount);
  hiddenResidentRef.current = hiddenResidentTurnCount;
  const historyViewActiveRef = useRef(Boolean(props.historyViewActive));
  historyViewActiveRef.current = Boolean(props.historyViewActive);

  const revealOlderTurns = useCallback(
    (count: number): void => {
      scrollPort?.detachFromTail();
      const container = scrollPort?.scrollElementRef.current ?? null;
      if (container && pendingPrependAnchorRef.current === null) {
        pendingPrependAnchorRef.current = captureTranscriptReadingAnchor(container);
      }
      setExtraRevealedTurns((current) => current + count);
    },
    [scrollPort],
  );

  useLayoutEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    const container = scrollPort?.scrollElementRef.current ?? null;
    if (!anchor || !container) {
      return;
    }
    pendingPrependAnchorRef.current = null;
    alignTranscriptReadingAnchor(container, anchor, {
      ...(scrollPort ? { beforeScroll: scrollPort.beginProgrammaticScroll } : {}),
    });
  }, [scrollPort, visibleTurnGroups]);

  useEffect(() => {
    if (!scrollPort) {
      return;
    }
    return scrollPort.registerOlderResidentRevealer(() => {
      if (historyViewActiveRef.current || hiddenResidentRef.current <= 0) {
        return false;
      }
      revealOlderTurns(5);
      return true;
    });
  }, [revealOlderTurns, scrollPort]);

  const ensureResidentMessageMounted = useCallback(
    (messageId: string): boolean => {
      if (props.historyViewActive) {
        return false;
      }
      const turnIndex = turnGroups.findIndex((turn) =>
        turn.items.some((item) => item.message.id === messageId),
      );
      if (turnIndex < 0 || turnIndex >= tailStartIndex) {
        return false;
      }
      const neededExtra = turnGroups.length - tailCap - turnIndex;
      scrollPort?.detachFromTail();
      setExtraRevealedTurns((current) => Math.max(current, neededExtra));
      return true;
    },
    [props.historyViewActive, scrollPort, tailCap, tailStartIndex, turnGroups],
  );

  const threadRef = props.presentationRef;

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
      {!props.historyViewActive && (hiddenResidentTurnCount > 0 || props.canLoadOlder === true) ? (
        <div className="transcript-bounded-tail-bar" data-testid="transcript-bounded-tail-bar">
          <button
            type="button"
            className="transcript-bounded-tail-button"
            data-testid="transcript-bounded-tail-button"
            disabled={hiddenResidentTurnCount === 0 && props.historyLoading === true}
            onClick={() => {
              if (hiddenResidentTurnCount > 0) {
                revealOlderTurns(5);
                return;
              }
              revealOlderTurns(10);
              void props.onLoadOlder?.();
            }}
          >
            {hiddenResidentTurnCount > 0
              ? (props.locale ?? 'zh-CN') === 'zh-CN'
                ? `展开更早对话（已收起 ${hiddenResidentTurnCount} 轮）`
                : `Show earlier turns (${hiddenResidentTurnCount} folded)`
              : props.historyLoading
                ? (props.locale ?? 'zh-CN') === 'zh-CN'
                  ? '正在加载更早对话…'
                  : 'Loading earlier history…'
                : (props.locale ?? 'zh-CN') === 'zh-CN'
                  ? '加载更早历史对话'
                  : 'Load earlier history'}
          </button>
        </div>
      ) : null}
      <TranscriptTurnList
        turns={visibleTurnGroups}
        pinnedMessageId={props.editingMessageId}
        streaming={props.streaming === true}
        staticFlow={!props.historyViewActive && visibleTurnGroups.length <= 24}
        onEnsureMessageMounted={ensureResidentMessageMounted}
        renderTurn={(turn) => {
          const turnIndex = turnIndexById.get(turn.id) ?? turnGroups.length - 1;
          const compactSettled =
            turn.id !== currentResponseTurnId &&
            turnGroups.length - 1 - turnIndex >= fullFidelityTailCount;
          return (
            <ChatTurnView
              turn={turn}
              props={props}
              compactSettled={compactSettled}
              workflows={workflowTurns.byTurn.get(turn.id) ?? EMPTY_WORKFLOWS}
              workflowError={turn.id === currentResponseTurnId ? workflowObservation.error : null}
              conversationSession={conversationSession}
              currentResponseTurnId={currentResponseTurnId}
              compactionActivityTurnId={compactionActivityTurnId}
              latestAssistantMessageId={latestAssistantMessageId}
              precedingUser={precedingUser}
              streamingCaretMessageId={streamingCaretMessageId}
              exploreRolesByMessageId={exploreRolesByMessageId}
              exploreFoldedMessageIds={exploreFoldedMessageIds}
              workDisclosureOpenByTurnId={workDisclosureOpenByTurnId}
              setWorkDisclosureOpenByTurnId={setWorkDisclosureOpenByTurnId}
              segmentState={segmentState}
              enteringIds={enteringIds}
              changedFilePathsByTurnId={changedFilePathsByTurnId}
            />
          );
        }}
      />
      {currentResponseTurnId === null &&
      (pendingRunStatusFooter || props.compactionActivity) ? (
        <section
          className="chat-turn-group is-current-response"
          data-testid="current-response-turn"
        >
          {props.compactionActivity ? (
            <CompactionActivity
              key={props.compactionActivity.operationId}
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
      {props.sessionId && props.workflowRequest && workflowTurns.unanchored.length > 0 ? (
        <article className="turn chat-turn chat-turn-assistant">
          <div className="chat-turn-body">
            <BackendWorkflowSequence sessionId={props.sessionId} request={props.workflowRequest}
              locale={props.locale ?? 'zh-CN'} workflows={workflowTurns.unanchored} />
          </div>
        </article>
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
