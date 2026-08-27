import { isPlaceholderSessionName } from './title-display';
import { isAssistantContentEmpty } from './assistant-message-content';
import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentFailure,
  ContextUsageSnapshot,
  ExecutionRunRecord,
  RunInterventionRecord,
  QueuedTurnRecord,
  MediaAttachmentRef,
  ModelRef,
  PromptAttachment,
  PromptContextRef,
  PermissionDecision,
  PermissionRequestContext,
  SessionRunOutcome,
  SessionRunPhase,
  SessionScope,
  SearchEvidence,
  SessionSummary,
  SessionTranscriptMessage,
  SessionTranscriptPageInfo,
  SessionTranscriptWindowInfo,
  SessionUserMessageIndexData,
  SubagentActivityView,
  SubagentBatchProjection,
  SubagentInvocation,
  SubagentTaskResult,
  ToolPresentation,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { SessionOutlineNode } from '@piwin/contracts';
import {
  isRunTerminal,
  mergeSearchEvidence,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  shouldAcceptContextUsage,
} from '@piwin/contracts';
import { extractUserFacingBody } from '@piwin/session/derive-default-name';
import {
  appendBoundedText,
  createBoundedTextAccumulator,
  type BoundedTextAccumulator,
  type BoundedTextAccumulatorOptions,
} from './bounded-text-accumulator';
import {
  adjustSessionListScopeTotal,
  createSessionListScopeState,
  getSessionListScopeMeta,
  setSessionListScopeMeta,
  type SessionListScopeState,
} from './session-list-scope';
import {
  evictCompletedFirst,
  MAX_SUBAGENT_BATCHES,
  MAX_SUBAGENT_CHILDREN,
  MAX_SUBAGENT_INVOCATIONS,
  MAX_SUBAGENT_TASK_RESULTS,
  putRecordLru,
  retainRecordKeys,
} from './record-budget';
import {
  measureTranscriptCacheBytes,
  prependBoundedTranscriptPage,
  retainBoundedTranscriptWindow,
} from './transcript-page-cache';
import {
  createEmptyWarmSessionCache,
  getWarmSessionSnapshot,
  putWarmSessionSnapshot,
  removeWarmSessionSnapshot,
  type WarmSessionCache,
} from './session-warm-cache';
import { markLatestAssistantFailure } from './run-failure-message';

const MAX_RETAINED_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';
const TOOL_OUTPUT_RETENTION_OPTIONS = {
  maximumBytes: MAX_RETAINED_TOOL_OUTPUT_BYTES,
  truncationMarker: TOOL_OUTPUT_TRUNCATION_MARKER,
} as const;
/**
 * Per-message tool card cap. Live streaming/running messages bypass the
 * transcript window budget, so the card array itself must stay bounded;
 * beyond the cap further tool/start events are dropped (their tool/end
 * updates no-op on the missing id).
 */
export const MAX_TOOL_CARDS_PER_MESSAGE = 128;

/** C1: maximum event ids retained for replay detection per session. */
const MAX_RETAINED_EVENT_IDS = 10_000;
/** C1: when the event id ring exceeds the max, drop this many oldest entries. */
const EVENT_ID_TRIM_BATCH = 5_000;

export type ToolCardUi = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
  /** Internal incremental UTF-8 accounting; omitted by legacy test fixtures. */
  outputRetainedBytes?: number;
  outputTruncated?: boolean;
  /** Host-supplied structured presentation when available. */
  presentation?: ToolPresentation;
  /** Owning run when host provided run identity. */
  runId?: string;
  /** Assistant response that emitted this tool when host provided proof. */
  responseMessageId?: string;
};

export type ChatMessageUi = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  thinking: string;
  tools: ToolCardUi[];
  attachments: PromptAttachment[];
  status: 'streaming' | 'done' | 'error';
  /** First observed reasoning delta timestamp for this response. */
  thinkingStartedAt?: number;
  /** Boundary where this response moved from reasoning to work/answer. */
  thinkingEndedAt?: number;
  searchEvidence?: SearchEvidence;
  createdAt?: string;
  /** Run that produced this assistant message when host provided run identity. */
  runId?: string;
  subagentActivity?: SubagentActivityView;
  /** True when the message text or thinking exceeded client memory boundaries and is head-truncated with a retention marker. */
  uiTruncated?: boolean;
  /** Internal incremental UTF-8 accounting for `text`; omitted by legacy fixtures. */
  textRetainedBytes?: number;
  textTruncated?: boolean;
  /** Internal incremental UTF-8 accounting for `thinking`; omitted by legacy fixtures. */
  thinkingRetainedBytes?: number;
  thinkingTruncated?: boolean;
  instructionDelivery?: SessionTranscriptMessage['instructionDelivery'];
  docCardSequence?: SessionTranscriptMessage['docCardSequence'];
  /** Context references attached to this user message (e.g. selections, file pins). */
  contextRefs?: PromptContextRef[];
  /** Model snapshot used to produce this Assistant message. */
  model?: ModelRef;
  /** Reply Writer is rewriting this bubble. */
  replyWriterPending?: boolean;
  /** Writer model that replaced the visible text. */
  replyWriter?: {
    model: ModelRef;
    language: import('@piwin/contracts').ReplyWriterLanguage;
  };
  /** Error message if generation or execution failed. */
  error?: string;
  /** Structured Agent failure when Host provided one. */
  failure?: AgentFailure;
};

export type TranscriptHistoryViewUi = {
  /** Indexed user message that owns this temporary bounded history view. */
  anchorMessageId: string;
  messages: ChatMessageUi[];
  runRecordsById: Record<string, RunRecordUi>;
};

/** Inline subagent stream state — live child session work shown in parent UI. */
export type SubagentStreamTool = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
  outputRetainedBytes?: number;
  outputTruncated?: boolean;
  presentation?: ToolPresentation;
  runId?: string;
  responseMessageId?: string;
};

/**
 * One completed assistant message from the child session, kept in the live
 * stream state until persisted history absorbs it (deduped by messageId).
 */
export type SubagentStreamSegment = {
  /** Real child-session message id (dedupe key against persisted history). */
  messageId: string;
  text: string;
  thinking: string;
  tools: SubagentStreamTool[];
  attachments?: PromptAttachment[];
  searchEvidence?: SearchEvidence;
  /** True when segment text/thinking was head-truncated at settle time. */
  truncated?: boolean;
};

/**
 * Upper bound for retained completed segments. History refreshes absorb
 * segments continuously; the cap only guards pathological children that emit
 * hundreds of messages while the window stays open.
 */
export const MAX_SUBAGENT_STREAM_SEGMENTS = 30;
/** Head-retention caps applied when a completed segment is settled into the
 * retained window; tighter than the live caps so MAX_SUBAGENT_STREAM_SEGMENTS
 * segments cannot each pin half a megabyte. */
export const MAX_RETAINED_SUBAGENT_SEGMENT_TEXT_BYTES = 64 * 1024;
export const MAX_RETAINED_SUBAGENT_SEGMENT_THINKING_BYTES = 32 * 1024;

export type SubagentStreamState = {
  childSessionId: string;
  /**
   * Completed assistant messages (causal order) that persisted history has
   * not caught up with yet. Without these, every message except the last
   * would vanish from an open child-session window (flat tails only ever
   * showed the current message).
   */
  completedSegments: SubagentStreamSegment[];
  /**
   * Monotonic count of finished assistant messages. Inspector history
   * refresh keys off this instead of `completedSegments.length` so a child
   * that exceeds the retained-segment cap still triggers a refresh.
   */
  completionRevision: number;
  /** Accumulated assistant text deltas of the current live message. */
  text: string;
  /** Incremental UTF-8 accounting for `text`; undefined on legacy state. */
  textRetainedBytes?: number;
  textTruncated?: boolean;
  /** Accumulated thinking deltas of the current live message. */
  thinking: string;
  /** Incremental UTF-8 accounting for `thinking`; undefined on legacy state. */
  thinkingRetainedBytes?: number;
  thinkingTruncated?: boolean;
  /** True when live text or thinking exceeded client memory boundaries. */
  truncated?: boolean;
  /** Tool calls attributed to the current live message. */
  tools: SubagentStreamTool[];
  attachments?: PromptAttachment[];
  searchEvidence?: SearchEvidence;
  /** Whether the child session is currently streaming. */
  streaming: boolean;
  /** Last message id seen from the child (for delta accumulation). */
  currentMessageId: string | null;
  /** Live child permission gate shown inside the child-session window. */
  permissionPrompt?: PermissionPromptUi | null;
};

/** C2: per-run historical record for turn-local work presentation. */
export type RunRecordUi = {
  runId: string;
  /** Last authority revision applied to this client projection. */
  revision?: number;
  /** Latest source status/phase retained for legacy semantic deduplication. */
  status?: ExecutionRunRecord['status'];
  phase?: SessionRunPhase;
  phaseDetail?: string;
  phaseHistory: Array<{ phase: SessionRunPhase; at: number; detail?: string }>;
  startedAt: number | null;
  endedAt: number | null;
  outcome?: SessionRunOutcome;
  terminalMessage?: string;
};

export type PermissionPromptUi = {
  requestId: string;
  sessionId: string;
  runId?: string;
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  context?: PermissionRequestContext;
};

/** Explicit Skill provenance for the currently submitted prompt. */
export type SkillActivityView = {
  skillId: string;
  name: string;
};

export type SessionListItemUi = {
  id: string;
  name: string;
  lastPreview?: string;
  messageCount?: number;
  updatedAt?: string;
  isPinned?: boolean;
  pinnedAt?: string;
  isArchived?: boolean;
  archivedAt?: string;
  /** SF-04: product session origin for branch/duplicate badge. */
  origin?: import('@piwin/contracts').ProductSessionOrigin;
  /** Last composer model for this session (restored on open/resume). */
  model?: import('@piwin/contracts').ModelRef;
  /** Last composer thinking level paired with `model`. */
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  /** Optional session scope for multi-project list tracking. */
  scope?: import('@piwin/contracts').SessionScope;
  /** Disk residency. Absent means local. */
  storage?: import('@piwin/contracts').SessionStorageInfo;
};

export type RunTerminalState =
  | { kind: 'none' }
  | { kind: 'stopped'; at: number }
  | { kind: 'paused'; at: number; checkpointId?: string }
  | { kind: 'failed'; message: string; at: number }
  | { kind: 'complete'; at: number };

export type ChatUiState = {
  /**
   * Active session scope. General is the cold-start default; opening a project
   * switches to project without deleting General history on the host.
   */
  activeScope: SessionScope;
  projectPath: string | null;
  projectTrusted: boolean;
  trustDialogOpen: boolean;
  sessions: SessionListItemUi[];
  /** General-scope sessions, maintained independently so the Conversations
   *  sidebar section stays populated even when a project is active. */
  generalSessions: SessionListItemUi[];
  /** Per-project session lists for the sidebar folder tree (see above). */
  projectSessionsByPath: Record<string, SessionListItemUi[]>;
  /** Host projection metadata per hydrated scope. */
  sessionListScopes: SessionListScopeState;
  activeSessionId: string | null;
  messages: ChatMessageUi[];
  /**
   * LRU of recently *left* sessions (≤ MAX_WARM_INACTIVE_SESSIONS). Message
   * JSON only — never live Artifact iframes. Active session is separate.
   * Resident budget ≈ 1 active + N warm inactive (default 2 → three total).
   * Hit on session/set paints instantly; miss paints empty and Host cold-loads.
   */
  warmSessionCache: WarmSessionCache;
  /** Host revision/cursor and bounded resident-history accounting. */
  transcriptWindow: {
    revision: string;
    totalCount: number;
    olderCursor?: string;
    retainedBytes: number;
    cacheLimitReached: boolean;
  } | null;
  /**
   * Temporary bounded history view. `messages` and `transcriptWindow` remain
   * the live tail so Host pushes never create a false contiguous timeline.
   */
  historyView: TranscriptHistoryViewUi | null;
  /** Host-owned user-message navigation anchors; never contains assistant/tool rows. */
  userMessageIndex: SessionUserMessageIndexData | null;
  /** Monotonic invalidation token used to reject stale async index responses. */
  userMessageIndexEpoch: number;
  /** Host-authoritative queued-turn projections keyed by session. */
  queuedTurnsBySession: Record<string, QueuedTurnRecord[]>;
  /** Queue CAS revision keyed by session. */
  queuedTurnQueueRevisions: Record<string, number>;
  outline: SessionOutlineNode[];
  /** Active session was archived without switching context. */
  activeSessionArchived: boolean;
  /**
   * True after resume `session/set({ awaitTranscript: true })` until
   * `session/load-messages` arrives. Ignores stream events for the new
   * session until hydrate completes. Paint policy on set:
   * warm hit → that session's rows; cold + awaiting → keep previous rows
   * under a loading banner (no empty flash); Host load replaces them.
   * New empty sessions leave this false (no load-messages is coming).
   */
  awaitingTranscript: boolean;
  /**
   * Session that owns the rows currently painted in `messages`. During a cold
   * resume, `activeSessionId` moves to the new session while old rows remain
   * visible; derived actions (fork/duplicate/retry) must not combine an old
   * message id with the new session id, so they verify this field first.
   */
  transcriptOwnerSessionId: string | null;
  /**
   * Title/origin/scope for the active session, independent of the currently
   * retained sidebar page. Sidebar paging replaces `sessions` but the active
   * title must survive; hydrate paths refresh this cache from any list that
   * still contains the row.
   */
  activeSessionMetadata: {
    id: string;
    name: string;
    scope?: SessionScope;
    origin?: SessionListItemUi['origin'];
    parentSessionId?: string;
  } | null;
  /**
   * Bumped when the sidebar locally admits a listable row (first-send title /
   * session/add). In-flight session/list hydrates capture the epoch at start
   * and are ignored if it changed before they apply.
   */
  sessionListMutationEpoch: number;
  /**
   * idle | streaming | pausing | aborting — explicit live-control feedback.
   * `streaming` remains true during both control transitions so existing guards keep working.
   */
  runPhase: 'idle' | 'streaming' | 'pausing' | 'aborting';
  /**
   * Host-owned selected-session admission. Send/run controls stay off while
   * unknown or reconciling so a false idle cannot issue if-idle.
   */
  foregroundAdmission: 'unknown' | 'reconciling' | 'ready';
  activeRunId: string | null;
  activeRunPhase: SessionRunPhase | null;
  /** Optional detail from latest run/phase (e.g. "Describing image…"). */
  activeRunPhaseDetail: string | null;
  activeRunStartedAt: number | null;
  lastTerminalRunId: string | null;
  streaming: boolean;
  runTerminal: RunTerminalState;
  /** True while model context compaction is running. */
  compacting: boolean;
  hostReady: boolean;
  hostMock: boolean;
  permissionPrompt: PermissionPromptUi | null;
  /** Explicit slash Skill currently associated with the foreground prompt. */
  activeSkill: SkillActivityView | null;
  error: string | null;
  lastCompactionMessage: string | null;
  lastCompactionSummary: string | null;
  lastCompactionTokensBefore: number | null;
  lastCompactionTokensAfter: number | null;
  lastCompactionDurationMs: number | null;
  lastCompactionFileOps: {
    readFiles: string[];
    modifiedFiles: string[];
    omittedCount?: number;
  } | null;
  /** CE-OBS last context/token usage for active session. */
  contextUsage: ContextUsageSnapshot | null;
  /**
   * C1: bounded ordered ring of received eventIds for replay detection.
   * Insertion-ordered Set for O(1) membership; when it exceeds
   * MAX_RETAINED_EVENT_IDS the oldest EVENT_ID_TRIM_BATCH entries are dropped.
   * Cleared on session switch.
   */
  receivedEventIds: Set<string>;
  /**
   * C1: last accepted envelope sequence per run (keyed by runId or "_global").
   * A new event with a sequence <= the stored value is stale.
   */
  lastAcceptedSequenceByRun: Record<string, number>;
  /**
   * C2: historical run records keyed by runId so completed turns keep
   * phase/outcome after a later run starts.
   */
  runRecordsById: Record<string, RunRecordUi>;
  /** Inline subagent streams keyed by childSessionId for live expand UX. */
  subagentStreams: Record<string, SubagentStreamState>;
  /** Latest child session summaries keyed by childSessionId (live list sync). */
  subagentChildren: Record<string, SessionSummary>;
  /** Durable parent-tool invocation projections keyed by invocation id. */
  subagentInvocations: Record<string, SubagentInvocation>;
  /** CE-SUB-ORCH: batch results keyed by runId (parallel subagent visibility). */
  subagentBatches: Record<string, SubagentBatchProjection>;
  /** CE-SUB-ORCH: latest per-task results keyed by `${runId}:${taskId}`. */
  subagentTaskResults: Record<string, SubagentTaskResult>;
  /**
   * Walkthrough artifacts keyed by owning assistant messageId (spec §5.1).
   * Cleared on session switch so stale artifacts never leak across sessions.
   */
  walkthroughsByMessageId: Record<string, WalkthroughArtifact>;
  /**
   * Background sessions with an in-progress session-turn. The open session's
   * spinner is derived from runPhase === 'streaming', not this map, so an
   * idle composer cannot keep spinning.
   */
  workingSessionIds: Record<string, true>;
  /**
   * Session IDs whose latest session-turn finished while the user was looking
   * elsewhere. Sidebar shows a dismissible completed marker until the user
   * opens the session (or the marker is cleared explicitly).
   */
  completedAttentionSessionIds: Record<string, true>;
  /**
   * Composer model for the in-flight turn. Used when Host omits
   * `message/start.model` so Conversation can keep the provider avatar after
   * the row leaves streaming (livePromptModel no longer applies).
   */
  pendingTurnModel: ModelRef | null;
};

export type ChatUiAction =
  | { type: 'scope/set'; scope: SessionScope }
  | { type: 'project/set'; path: string; trusted: boolean }
  | { type: 'project/clear' }
  | { type: 'project/trust-dialog'; open: boolean }
  | { type: 'project/trusted' }
  | { type: 'session/set'; sessionId: string; awaitTranscript?: boolean }
  | { type: 'session/add'; sessionId: string; name: string }
  | { type: 'session/hydrate'; sessions: SessionListItemUi[] }
  | { type: 'session/hydrate-general'; sessions: SessionListItemUi[] }
  | {
      type: 'session/hydrate-scope';
      scope: SessionScope;
      sessions: SessionListItemUi[];
      totalCount: number;
      truncated: boolean;
      fillActiveList?: boolean;
      /** Epoch captured when the Host list request started. */
      mutationEpoch?: number;
    }
  | {
      type: 'session/hydrate-project';
      projectPath: string;
      sessions: SessionListItemUi[];
    }
  | { type: 'session/retain-project-paths'; projectPaths: string[] }
  | {
      type: 'session/load-messages';
      sessionId: string;
      messages: SessionTranscriptMessage[];
      transcriptPage?: SessionTranscriptPageInfo;
      outline?: SessionOutlineNode[];
      contextUsage?: ContextUsageSnapshot | null;
      /** Whether the host has a live handle; this is not a run-status signal. */
      live?: boolean;
      /** Merge a stale-tail refresh without replacing the active local turn. */
      preserveActiveTail?: boolean;
    }
  | {
      type: 'session/prepend-messages';
      sessionId: string;
      messages: SessionTranscriptMessage[];
      transcriptPage: SessionTranscriptPageInfo;
    }
  | {
      type: 'session/seek-messages';
      sessionId: string;
      epoch: number;
      messages: SessionTranscriptMessage[];
      window: SessionTranscriptWindowInfo;
    }
  | {
      type: 'session/user-message-index';
      sessionId: string;
      epoch: number;
      index: SessionUserMessageIndexData;
    }
  | { type: 'session/return-to-live'; sessionId: string }
  | {
      type: 'session/queued-turns-hydrate';
      sessionId: string;
      queueRevision: number;
      queuedTurns: QueuedTurnRecord[];
    }
  | { type: 'session/update'; session: SessionListItemUi }
  | { type: 'session/remove'; sessionId: string }
  | { type: 'session/mark-archived-active'; archived: boolean }
  | { type: 'session/hide-from-list'; sessionId: string }
  | { type: 'session/clear-active' }
  | {
      type: 'session/branch-switched';
      sessionId: string;
      messages?: SessionTranscriptMessage[];
      /** Optimistic clip: drop this id and everything after it, keep prefix UI rows. */
      clipBeforeMessageId?: string;
      transcriptPage?: SessionTranscriptPageInfo;
    }
  | {
      type: 'user/send';
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
      /** Client-generated id so failed sends can roll back the optimistic bubble. */
      clientMessageId?: string;
      /** Skill selected by the composer, if this prompt used `/skill`. */
      skill?: SkillActivityView;
      /**
       * Composer model for this turn. Stamped onto assistant rows when Host
       * omits `message/start.model`, so Conversation keeps the avatar after
       * streaming ends (livePromptModel no longer applies to completed rows).
       */
      model?: ModelRef;
    }
  | {
      type: 'user/steer';
      text: string;
      /** Client-generated id shared with Host transcript persistence. */
      clientMessageId: string;
      /** Optimistic Host intervention identity; reconciled by the first push. */
      instructionId?: string;
      targetRunId?: string;
    }
  | { type: 'user/send-rollback'; clientMessageId: string }
  | { type: 'run/pausing' }
  | { type: 'run/pause-failed' }
  | { type: 'run/aborting' }
  | { type: 'run/abort-failed' }
  | { type: 'run/accepted'; runId: string; acceptedAt?: string }
  | { type: 'run/updated'; run: ExecutionRunRecord }
  | { type: 'run/terminal'; run: ExecutionRunRecord }
  | { type: 'foreground/admission'; admission: 'unknown' | 'reconciling' | 'ready' }
  | {
      /** ADR 0038 reconciliation: Host authority says no run exists, but the
       * UI still shows one streaming (lost terminal push). */
      type: 'run/stale-clear';
      sessionId: string;
    }
  | { type: 'run/intervention-updated'; intervention: RunInterventionRecord }
  | { type: 'session/queued-turn-updated'; queuedTurn: QueuedTurnRecord }
  | { type: 'run/terminal-dismiss' }
  | { type: 'session/attention-dismiss'; sessionId: string }
  | { type: 'host/status'; ready: boolean; mock: boolean }
  | { type: 'permission/show'; prompt: PermissionPromptUi }
  | { type: 'permission/clear'; requestId: string }
  | {
      type: 'event';
      sessionId: string;
      event: AgentEvent;
      envelope?: AgentEventEnvelope;
    }
  | {
      type: 'event/batch';
      sessionId: string;
      events: AgentEvent[];
      envelopes?: Array<AgentEventEnvelope | undefined>;
    }
  | { type: 'compaction/dismiss' }
  | { type: 'error'; message: string }
  | { type: 'error/clear' }
  | { type: 'transcript/append'; sessionId: string; message: SessionTranscriptMessage }
  | {
      type: 'reply-writer/updated';
      sessionId: string;
      messageId: string;
      status: 'started' | 'applied' | 'failed';
      model?: ModelRef;
      language?: import('@piwin/contracts').ReplyWriterLanguage;
    }
  | {
      type: 'subagent/stream';
      parentSessionId: string;
      childSessionId: string;
      event: AgentEvent;
      envelope?: AgentEventEnvelope;
    }
  | { type: 'subagent/clear-stream'; childSessionId: string }
  | { type: 'subagent/updated'; parentSessionId: string; child: SessionSummary }
  | {
      type: 'subagent/invocation-updated';
      parentSessionId: string;
      invocation: SubagentInvocation;
    }
  | {
      type: 'subagent/children-hydrate';
      parentSessionId: string;
      children: SessionSummary[];
    }
  | {
      type: 'subagent/invocations-hydrate';
      parentSessionId: string;
      invocations: SubagentInvocation[];
    }
  | {
      type: 'subagent/batch-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentBatchProjection;
    }
  | {
      type: 'subagent/task-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentTaskResult;
    }
  | { type: 'walkthrough/hydrate'; artifacts: WalkthroughArtifact[] }
  | { type: 'walkthrough/updated'; artifact: WalkthroughArtifact }
  | { type: 'walkthrough/remove'; messageId: string };

export function createInitialChatUiState(): ChatUiState {
  return {
    activeScope: { kind: 'general' },
    projectPath: null,
    projectTrusted: false,
    trustDialogOpen: false,
    sessions: [],
    generalSessions: [],
    /** Per-project session lists for the sidebar folder tree. Kept independent
     *  from `sessions` (the active scope's list) so any number of project
     *  folders can stay open with their own conversations visible. */
    projectSessionsByPath: {},
    sessionListScopes: createSessionListScopeState(),
    activeSessionId: null,
    messages: [],
    warmSessionCache: createEmptyWarmSessionCache(),
    transcriptWindow: null,
    historyView: null,
    userMessageIndex: null,
    userMessageIndexEpoch: 0,
    queuedTurnsBySession: {},
    queuedTurnQueueRevisions: {},
    outline: [],
    activeSessionArchived: false,
    awaitingTranscript: false,
    transcriptOwnerSessionId: null,
    activeSessionMetadata: null,
    sessionListMutationEpoch: 0,
    runPhase: 'idle',
    /**
     * Host-owned selected-session admission. Send/run controls stay off while
     * unknown or reconciling so a false idle cannot issue if-idle.
     */
    foregroundAdmission: 'unknown' as const,
    activeRunId: null,
    activeRunPhase: null,
    activeRunPhaseDetail: null,
    activeRunStartedAt: null,
    lastTerminalRunId: null,
    streaming: false,
    runTerminal: { kind: 'none' },
    compacting: false,
    hostReady: false,
    hostMock: true,
    permissionPrompt: null,
    activeSkill: null,
    error: null,
    lastCompactionMessage: null,
    lastCompactionSummary: null,
    lastCompactionTokensBefore: null,
    lastCompactionTokensAfter: null,
    lastCompactionDurationMs: null,
    lastCompactionFileOps: null,
    contextUsage: null,
    receivedEventIds: new Set<string>(),
    lastAcceptedSequenceByRun: {},
    runRecordsById: {},
    subagentStreams: {},
    subagentChildren: {},
    subagentInvocations: {},
    subagentBatches: {},
    subagentTaskResults: {},
    walkthroughsByMessageId: {},
    workingSessionIds: {},
    completedAttentionSessionIds: {},
    pendingTurnModel: null,
  };
}

const CLEARED_SUBAGENT_UI = {
  subagentStreams: {} as Record<string, SubagentStreamState>,
  subagentChildren: {} as Record<string, SessionSummary>,
  subagentInvocations: {} as Record<string, SubagentInvocation>,
  subagentBatches: {} as Record<string, SubagentBatchProjection>,
  subagentTaskResults: {} as Record<string, SubagentTaskResult>,
};

function isTerminalSubagentChild(child: SessionSummary): boolean {
  return (
    child.subagentStatus === 'done' ||
    child.subagentStatus === 'failed' ||
    child.subagentStatus === 'cancelled'
  );
}

function isTerminalSubagentInvocation(invocation: SubagentInvocation): boolean {
  return (
    invocation.status === 'completed' ||
    invocation.status === 'needs-integration' ||
    invocation.status === 'failed' ||
    invocation.status === 'cancelled'
  );
}

/**
 * Shared persisted-transcript → UI message projection.
 *
 * Hydrated transcripts never render as streaming (status is rewritten to
 * done); the live event path keeps its own streaming status. Keeping this in
 * one pure function prevents the foreground chat and the subagent inspector
 * from drifting in tool/attachment/status mapping.
 */
export function mapTranscriptMessagesToUi(
  messages: SessionTranscriptMessage[],
  options: { keepStreamingStatus?: boolean } = {},
): ChatMessageUi[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    // Legacy transcripts may still store mode/skill wrappers that were once
    // sent as input.text. Project only the human-authored body for display;
    // attachments stay untouched so vision media still renders as originals.
    text:
      message.role === 'user'
        ? extractUserFacingBody(typeof message.text === 'string' ? message.text : '')
        : (message.text ?? ''),
    thinking: message.thinking ?? '',
    tools: (message.tools ?? []).map((tool) => {
      const output = createBoundedToolOutput(tool.presentation?.output?.text ?? tool.output ?? '');
      return {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        status: tool.status,
        output: output.text,
        outputRetainedBytes: output.retainedBytes,
        outputTruncated: output.truncated,
        ...(tool.runId ? { runId: tool.runId } : {}),
        ...(tool.responseMessageId ? { responseMessageId: tool.responseMessageId } : {}),
        ...(tool.presentation
          ? { presentation: projectBoundedToolPresentation(tool.presentation, output) }
          : {}),
      };
    }),
    attachments: message.attachments ?? [],
    status:
      options.keepStreamingStatus === true
        ? message.status
        : message.status === 'streaming'
          ? 'done'
          : message.status,
    ...(message.searchEvidence ? { searchEvidence: message.searchEvidence } : {}),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.thinkingStartedAt !== undefined
      ? { thinkingStartedAt: parseEventTime(message.thinkingStartedAt) }
      : {}),
    ...(message.thinkingEndedAt !== undefined
      ? { thinkingEndedAt: parseEventTime(message.thinkingEndedAt) }
      : {}),
    ...(message.subagentActivity ? { subagentActivity: message.subagentActivity } : {}),
    ...(message.instructionDelivery ? { instructionDelivery: message.instructionDelivery } : {}),
    ...(message.docCardSequence ? { docCardSequence: message.docCardSequence } : {}),
    ...(message.contextRefs && message.contextRefs.length > 0
      ? { contextRefs: message.contextRefs }
      : {}),
    ...(message.model ? { model: message.model } : {}),
    ...(message.replyWriter
      ? {
          replyWriter: {
            model: message.replyWriter.model,
            language: message.replyWriter.language,
          },
        }
      : {}),
    ...(message.terminalMessage ? { error: message.terminalMessage } : {}),
    ...(message.failure ? { failure: message.failure } : {}),
  }));
}

export const MAX_LIVE_ASSISTANT_TEXT_BYTES = 500_000;
export const MAX_LIVE_THINKING_BYTES = 200_000;
export const STREAMING_TEXT_TRUNCATION_MARKER = '\n[display truncated: retention limit reached]';
export const STREAMING_THINKING_TRUNCATION_MARKER =
  '\n[reasoning truncated: retention limit reached]';
export const STREAMING_TEXT_RETENTION_OPTIONS: BoundedTextAccumulatorOptions = {
  maximumBytes: MAX_LIVE_ASSISTANT_TEXT_BYTES,
  truncationMarker: STREAMING_TEXT_TRUNCATION_MARKER,
};
export const STREAMING_THINKING_RETENTION_OPTIONS: BoundedTextAccumulatorOptions = {
  maximumBytes: MAX_LIVE_THINKING_BYTES,
  truncationMarker: STREAMING_THINKING_TRUNCATION_MARKER,
};
const TRANSCRIPT_LIVE_TAIL_PIN_COUNT = 3;

const textEncoder = new TextEncoder();

export function calculateUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

/**
 * Append a delta to live streamed text with incremental UTF-8 accounting.
 * The ordinary path encodes only the delta; retained state that predates the
 * accounting fields (legacy fixtures, hydrated history) is normalized once
 * with a single full encode before the first append. Once truncated, every
 * later append is a constant-time no-op — the head is kept and marked.
 */
export function appendBoundedLiveText(
  accumulator: {
    text: string;
    retainedBytes?: number | undefined;
    truncated?: boolean | undefined;
  },
  delta: string,
  options: BoundedTextAccumulatorOptions,
): BoundedTextAccumulator {
  const normalized: BoundedTextAccumulator = accumulator.truncated
    ? {
        text: accumulator.text,
        retainedBytes: accumulator.retainedBytes ?? calculateUtf8ByteLength(accumulator.text),
        truncated: true,
      }
    : accumulator.retainedBytes === undefined
      ? createBoundedTextAccumulator(accumulator.text, options)
      : {
          text: accumulator.text,
          retainedBytes: accumulator.retainedBytes,
          truncated: false,
        };
  return appendBoundedText(normalized, delta, options);
}

function collectLiveTranscriptMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  const liveIds = new Set<string>();

  // 1. Retain any message actively streaming or running a tool
  for (const message of messages) {
    if (message.status === 'streaming' || message.tools.some((tool) => tool.status === 'running')) {
      liveIds.add(message.id);
    }
  }

  // 2. Retain the live tail (last N items)
  const tailStart = Math.max(0, messages.length - TRANSCRIPT_LIVE_TAIL_PIN_COUNT);
  for (let index = tailStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (message !== undefined) {
      liveIds.add(message.id);
    }
  }

  // 3. If streaming, also retain the user prompt initiating the active turn
  if (streaming) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        liveIds.add(messages[index]!.id);
        break;
      }
    }
  }

  return liveIds;
}

function collectRetainedTranscriptMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  const retainedIds = collectLiveTranscriptMessageIds(messages, streaming);
  const tailStart = Math.max(0, messages.length - SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS);
  for (let index = tailStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (message !== undefined) retainedIds.add(message.id);
  }
  return retainedIds;
}

function collectActiveTurnMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  let activeStart = messages.findIndex(
    (message) =>
      message.status === 'streaming' || message.tools.some((tool) => tool.status === 'running'),
  );
  if (streaming) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        activeStart = index;
        break;
      }
    }
  }
  if (activeStart < 0) return new Set();
  return new Set(messages.slice(activeStart).map((message) => message.id));
}

function mergeRefreshedTailWithLiveMessages(
  refreshedMessages: readonly ChatMessageUi[],
  currentMessages: readonly ChatMessageUi[],
  streaming: boolean,
): ChatMessageUi[] {
  const liveIds = collectActiveTurnMessageIds(currentMessages, streaming);
  if (liveIds.size === 0) return [...refreshedMessages];
  const currentLiveMessages = currentMessages.filter((message) => liveIds.has(message.id));
  const durablePrefix = refreshedMessages.filter((message) => !liveIds.has(message.id));
  return [...durablePrefix, ...currentLiveMessages];
}

function retainRunRecordsForMessages(
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
  messages: readonly ChatMessageUi[],
  activeRunId: string | null,
): Record<string, RunRecordUi> {
  const retainedRunIds = new Set<string>();
  if (activeRunId !== null) retainedRunIds.add(activeRunId);
  for (const message of messages) {
    if (message.runId !== undefined) retainedRunIds.add(message.runId);
    for (const tool of message.tools) {
      if (tool.runId !== undefined) retainedRunIds.add(tool.runId);
    }
  }
  return Object.fromEntries(
    Object.entries(runRecordsById).filter(([runId]) => retainedRunIds.has(runId)),
  );
}

function enforceBoundedTranscriptWindow(state: ChatUiState): ChatUiState {
  const bounded = retainBoundedTranscriptWindow(
    state.messages,
    collectRetainedTranscriptMessageIds(state.messages, state.streaming),
  );
  const cacheLimitReached =
    (state.transcriptWindow?.cacheLimitReached ?? false) || bounded.cacheLimitReached;
  const transcriptWindow = state.transcriptWindow
    ? {
        revision: state.transcriptWindow.revision,
        totalCount: state.transcriptWindow.totalCount,
        ...(!cacheLimitReached && state.transcriptWindow.olderCursor
          ? { olderCursor: state.transcriptWindow.olderCursor }
          : {}),
        retainedBytes: bounded.retainedBytes,
        cacheLimitReached,
      }
    : null;
  if (bounded.droppedCount === 0) {
    return { ...state, transcriptWindow };
  }
  const retainedMessageIds = new Set(bounded.messages.map((message) => message.id));
  return {
    ...state,
    messages: bounded.messages,
    transcriptWindow,
    runRecordsById: retainRunRecordsForMessages(
      state.runRecordsById,
      bounded.messages,
      state.activeRunId,
    ),
    walkthroughsByMessageId: Object.fromEntries(
      Object.entries(state.walkthroughsByMessageId).filter(([messageId]) =>
        retainedMessageIds.has(messageId),
      ),
    ),
  };
}

function refreshActiveSessionMetadata(state: ChatUiState, next: Partial<ChatUiState>): ChatUiState {
  const activeSessionId =
    next.activeSessionId !== undefined ? next.activeSessionId : state.activeSessionId;
  if (activeSessionId === null) {
    return { ...state, ...next, activeSessionMetadata: null };
  }
  const lists: SessionListItemUi[][] = [
    (next.sessions as SessionListItemUi[] | undefined) ?? state.sessions,
    (next.generalSessions as SessionListItemUi[] | undefined) ?? state.generalSessions,
    ...Object.values(
      (next.projectSessionsByPath as Record<string, SessionListItemUi[]> | undefined) ??
        state.projectSessionsByPath,
    ),
  ];
  const item = lists.flat().find((session) => session.id === activeSessionId);
  // A changed active session with no list row yet must not inherit the
  // previous session's title (first-send / cold resume). Keep the previous
  // cache only when the active session id did not change (sidebar paging).
  const activeSessionChanged =
    next.activeSessionId !== undefined && next.activeSessionId !== state.activeSessionId;
  return {
    ...state,
    ...next,
    activeSessionMetadata: item
      ? {
          id: item.id,
          name: item.name,
          ...(item.scope ? { scope: item.scope } : {}),
          ...(item.origin ? { origin: item.origin } : {}),
          ...(item.origin?.kind === 'fork' ? { parentSessionId: item.origin.rootSessionId } : {}),
        }
      : activeSessionChanged
        ? null
        : state.activeSessionMetadata,
  };
}

function dedupeSessionsById(sessions: SessionListItemUi[]): SessionListItemUi[] {
  const seen = new Set<string>();
  const unique: SessionListItemUi[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    unique.push(session);
  }
  return unique;
}

function sessionListContainsId(list: readonly SessionListItemUi[], sessionId: string): boolean {
  return list.some((session) => session.id === sessionId);
}

function owningScopeFromLists(state: ChatUiState, sessionId: string): SessionScope | null {
  if (sessionListContainsId(state.generalSessions, sessionId)) {
    return { kind: 'general' };
  }
  for (const [projectPath, list] of Object.entries(state.projectSessionsByPath)) {
    if (sessionListContainsId(list, sessionId)) {
      return { kind: 'project', projectPath };
    }
  }
  return null;
}



function chatUiReducerCore(state: ChatUiState, action: ChatUiAction): ChatUiState {
  switch (action.type) {
    case 'scope/set':
      if (action.scope.kind === 'general' && state.activeScope.kind === 'general') {
        return state;
      }
      if (
        action.scope.kind === 'project' &&
        state.activeScope.kind === 'project' &&
        action.scope.projectPath === state.activeScope.projectPath
      ) {
        return state;
      }
      return {
        ...state,
        activeScope: action.scope,
        // Switching scope clears the visible session list; hydrate reloads it.
        sessions: [],
        // Keep the live session identity so composer snapshots see A→B, not
        // a fake New Agent gap. Transcript paint is cleared below.
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/set':
      return {
        ...state,
        activeScope: { kind: 'project', projectPath: action.path },
        projectPath: action.path,
        projectTrusted: action.trusted,
        trustDialogOpen: !action.trusted,
        // A project owns its own history. Do not leave another project's rows or
        // transcript visible while the new project's session index is loading.
        // Keep activeSessionId: composer must not treat this as New Agent.
        sessions: [],
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        // Subagent activity is scoped to the active parent session; switching
        // scope must not surface another session's children or live streams.
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/clear':
      return {
        ...state,
        activeScope: { kind: 'general' },
        projectPath: null,
        projectTrusted: false,
        trustDialogOpen: false,
        sessions: [],
        transcriptOwnerSessionId: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        activeSkill: null,
        error: null,
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'project/trust-dialog':
      return { ...state, trustDialogOpen: action.open };
    case 'project/trusted':
      return { ...state, projectTrusted: true, trustDialogOpen: false };
    case 'session/set': {
      // Paint-first first send: draft mode may already show an optimistic user
      // bubble before session/create returns. Activating that new session must
      // keep the bubble instead of wiping the transcript.
      const preserveOptimisticDraftSend =
        state.activeSessionId === null &&
        state.streaming === true &&
        state.messages.length > 0 &&
        state.messages.every((message) => message.role === 'user');
      // Explicit opt-in from handleResumeSession only. session/create → session/set
      // must NOT await (no load-messages follows; events/walkthrough would stall).
      const awaitingTranscript = !preserveOptimisticDraftSend && action.awaitTranscript === true;
      const switchingAway =
        state.activeSessionId !== null && state.activeSessionId !== action.sessionId;

      // Stash the session we leave into the inactive warm LRU (message JSON only).
      let warmSessionCache = state.warmSessionCache;
      if (switchingAway && state.messages.length > 0 && state.activeSessionId) {
        warmSessionCache = putWarmSessionSnapshot(warmSessionCache, {
          sessionId: state.activeSessionId,
          messages: state.messages,
          transcriptWindow: state.transcriptWindow,
          outline: state.outline,
          runRecordsById: state.runRecordsById,
          walkthroughsByMessageId: state.walkthroughsByMessageId,
          contextUsage: state.contextUsage,
        });
      }

      const warmHit =
        switchingAway || state.activeSessionId === null
          ? getWarmSessionSnapshot(warmSessionCache, action.sessionId)
          : null;
      // Promote warm → active: drop the inactive slot so we do not hold two
      // copies of the same session's rows. On next leave, putWarm stashes again.
      if (warmHit) {
        warmSessionCache = removeWarmSessionSnapshot(warmSessionCache, action.sessionId);
      }

      // Paint policy while Host resume is in flight:
      // 1) warm hit → that session's rows (correct id)
      // 2) cold + awaiting → keep previous rows under a loading banner (no empty flash)
      // 3) else → empty
      // Stream events stay ignored while awaitingTranscript is true.
      const keepPreviousWhileLoading = !warmHit && awaitingTranscript && state.messages.length > 0;
      // Owner follows the painted rows: new session for fresh/warm paint,
      // the previous owner while old rows stay visible under the loading banner.
      const transcriptOwnerSessionId =
        keepPreviousWhileLoading && switchingAway
          ? (state.transcriptOwnerSessionId ?? state.activeSessionId)
          : action.sessionId;

      return {
        ...state,
        activeSessionId: action.sessionId,
        warmSessionCache,
        pendingTurnModel: switchingAway ? null : state.pendingTurnModel,
        messages: preserveOptimisticDraftSend
          ? state.messages
          : warmHit
            ? warmHit.messages
            : keepPreviousWhileLoading
              ? state.messages
              : [],
        transcriptWindow: warmHit
          ? warmHit.transcriptWindow
          : keepPreviousWhileLoading
            ? state.transcriptWindow
            : null,
        historyView: null,
        userMessageIndex:
          preserveOptimisticDraftSend || state.activeSessionId === action.sessionId
            ? state.userMessageIndex
            : null,
        userMessageIndexEpoch:
          state.activeSessionId === action.sessionId
            ? state.userMessageIndexEpoch
            : state.userMessageIndexEpoch + 1,
        runPhase: preserveOptimisticDraftSend ? state.runPhase : 'idle',
        foregroundAdmission: preserveOptimisticDraftSend ? 'ready' : 'reconciling',
        activeRunId: preserveOptimisticDraftSend ? state.activeRunId : null,
        activeRunPhase: preserveOptimisticDraftSend ? state.activeRunPhase : null,
        activeRunPhaseDetail: preserveOptimisticDraftSend ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: preserveOptimisticDraftSend ? state.activeRunStartedAt : null,
        lastTerminalRunId: null,
        streaming: preserveOptimisticDraftSend ? true : false,
        activeSkill: preserveOptimisticDraftSend ? state.activeSkill : null,
        outline: warmHit ? warmHit.outline : keepPreviousWhileLoading ? state.outline : [],
        activeSessionArchived: false,
        awaitingTranscript,
        transcriptOwnerSessionId,
        runTerminal: { kind: 'none' },
        // C1: clear event id ring for the new session
        receivedEventIds: new Set<string>(),
        lastAcceptedSequenceByRun: {},
        runRecordsById: warmHit
          ? warmHit.runRecordsById
          : keepPreviousWhileLoading
            ? state.runRecordsById
            : {},
        walkthroughsByMessageId: warmHit
          ? warmHit.walkthroughsByMessageId
          : keepPreviousWhileLoading
            ? state.walkthroughsByMessageId
            : {},
        contextUsage: warmHit
          ? warmHit.contextUsage
          : keepPreviousWhileLoading
            ? state.contextUsage
            : state.activeSessionId === action.sessionId
              ? state.contextUsage
              : null,
        // Subagent activity belongs to the previously active parent; the new
        // session hydrates its own children on resume.
        ...CLEARED_SUBAGENT_UI,
        workingSessionIds: preserveOptimisticDraftSend
          ? { ...state.workingSessionIds, [action.sessionId]: true }
          : state.workingSessionIds,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
      };
    }
    case 'session/load-messages': {
      // Drop stale resume responses if the user already switched again.
      if (state.activeSessionId !== null && state.activeSessionId !== action.sessionId) {
        return state;
      }
      // Session hydration can race the foreground-run admission query. A
      // Host-confirmed active Run is authoritative for the composer, so a
      // transcript read must not turn Stop back into Send while replacing
      // the visible history.
      const preserveRunProjection = action.preserveActiveTail || state.activeRunId !== null;
      const hasConfirmedActiveRun = state.activeRunId !== null;
      const refreshedMessages = mapTranscriptMessagesToUi(action.messages);
      const candidateMessages = action.preserveActiveTail
        ? mergeRefreshedTailWithLiveMessages(refreshedMessages, state.messages, state.streaming)
        : refreshedMessages;
      const bounded = retainBoundedTranscriptWindow(
        candidateMessages,
        collectRetainedTranscriptMessageIds(candidateMessages, state.streaming),
      );
      const messages = bounded.messages;
      const retainedMessageIds = new Set(messages.map((message) => message.id));
      const hydratedRunRecords = buildRunRecordsFromTranscriptMessages(
        action.messages.filter((message) => retainedMessageIds.has(message.id)),
      );
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages,
        historyView: null,
        transcriptWindow: action.transcriptPage
          ? {
              revision: action.transcriptPage.revision,
              totalCount: action.transcriptPage.totalCount,
              ...(!bounded.cacheLimitReached && action.transcriptPage.olderCursor
                ? { olderCursor: action.transcriptPage.olderCursor }
                : {}),
              retainedBytes: bounded.retainedBytes,
              cacheLimitReached: bounded.cacheLimitReached,
            }
          : null,
        runPhase: preserveRunProjection ? state.runPhase : 'idle',
        activeRunId: preserveRunProjection ? state.activeRunId : null,
        activeRunPhase: preserveRunProjection ? state.activeRunPhase : null,
        activeRunPhaseDetail: preserveRunProjection ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: preserveRunProjection ? state.activeRunStartedAt : null,
        lastTerminalRunId: preserveRunProjection ? state.lastTerminalRunId : null,
        streaming: preserveRunProjection ? state.streaming : false,
        activeSkill: preserveRunProjection ? state.activeSkill : null,
        outline: action.outline ?? [],
        activeSessionArchived: preserveRunProjection ? state.activeSessionArchived : false,
        awaitingTranscript: false,
        transcriptOwnerSessionId: action.sessionId,
        contextUsage: action.contextUsage !== undefined ? action.contextUsage : state.contextUsage,
        runTerminal: preserveRunProjection ? state.runTerminal : { kind: 'none' },
        error: null,
        runRecordsById: preserveRunProjection
          ? { ...hydratedRunRecords, ...state.runRecordsById }
          : hydratedRunRecords,
        // Walkthrough artifacts are hydrated separately via walkthrough/list
        // after load. Do NOT clear the map here: session/set (which fires
        // before load-messages) already clears it, and a walkthrough/list
        // response may resolve before load-messages is dispatched — clearing
        // here would wipe the freshly-hydrated map.
        // `live` means the session handle can accept a future prompt, not that
        // a prompt is currently running. Drop a leftover sidebar spinner unless
        // this hydration is keeping a confirmed or still-streaming run.
        workingSessionIds:
          hasConfirmedActiveRun || (preserveRunProjection && state.streaming)
            ? { ...state.workingSessionIds, [action.sessionId]: true }
            : removeWorkingSessionId(state.workingSessionIds, action.sessionId),
      };
    }
    case 'session/prepend-messages': {
      if (
        state.activeSessionId !== action.sessionId ||
        state.transcriptWindow === null ||
        state.transcriptWindow.revision !== action.transcriptPage.revision
      ) {
        return state;
      }
      const olderMessages = mapTranscriptMessagesToUi(action.messages);
      const merged = prependBoundedTranscriptPage(state.messages, olderMessages);
      return {
        ...state,
        messages: merged.messages,
        transcriptWindow: {
          revision: action.transcriptPage.revision,
          totalCount: action.transcriptPage.totalCount,
          ...(!merged.cacheLimitReached && action.transcriptPage.olderCursor
            ? { olderCursor: action.transcriptPage.olderCursor }
            : {}),
          retainedBytes: merged.retainedBytes,
          cacheLimitReached: merged.cacheLimitReached,
        },
        runRecordsById: {
          ...buildRunRecordsFromTranscriptMessages(action.messages),
          ...state.runRecordsById,
        },
      };
    }
    case 'session/seek-messages': {
      if (
        state.activeSessionId !== action.sessionId ||
        state.userMessageIndexEpoch !== action.epoch
      ) {
        return state;
      }
      const messages = mapTranscriptMessagesToUi(action.messages);
      const bounded = retainBoundedTranscriptWindow(
        messages,
        collectRetainedTranscriptMessageIds(messages, state.streaming),
      );
      const retainedMessageIds = new Set(bounded.messages.map((message) => message.id));
      return {
        ...state,
        historyView: {
          anchorMessageId: action.window.anchorMessageId,
          messages: bounded.messages,
          runRecordsById: buildRunRecordsFromTranscriptMessages(
            action.messages.filter((message) => retainedMessageIds.has(message.id)),
          ),
        },
      };
    }
    case 'session/user-message-index':
      return state.activeSessionId === action.sessionId &&
        state.userMessageIndexEpoch === action.epoch
        ? { ...state, userMessageIndex: action.index }
        : state;
    case 'session/return-to-live':
      return state.activeSessionId === action.sessionId && state.historyView !== null
        ? { ...state, historyView: null }
        : state;
    case 'session/add': {
      // Stamp updatedAt so Conversations / project lists sort the new row to the
      // top (sort is pinned first, then updatedAt desc; missing timestamps sink).
      const createdAt = new Date().toISOString();
      const projectPath =
        state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
      const newSession: SessionListItemUi = {
        id: action.sessionId,
        name: action.name,
        updatedAt: createdAt,
        scope: projectPath != null ? { kind: 'project', projectPath } : { kind: 'general' },
      };
      // Sidebar policy: placeholder / empty names never enter the list. The
      // session can still be active (composer) until the first text title lands.
      const listable = !isPlaceholderSessionName(action.name);
      const alreadyKnown =
        projectPath != null
          ? sessionListContainsId(state.projectSessionsByPath[projectPath] ?? [], action.sessionId)
          : sessionListContainsId(state.generalSessions, action.sessionId);
      const nextSessionsForPath = listable
        ? dedupeSessionsById([
            newSession,
            ...state.sessions.filter((item) => item.id !== action.sessionId),
          ])
        : state.sessions.filter((item) => item.id !== action.sessionId);
      const nextGeneralSessions = listable
        ? dedupeSessionsById([
            newSession,
            ...state.generalSessions.filter((item) => item.id !== action.sessionId),
          ])
        : state.generalSessions.filter((item) => item.id !== action.sessionId);
      const owningScope: SessionScope =
        projectPath != null ? { kind: 'project', projectPath } : { kind: 'general' };
      const nextSessionListScopes =
        listable && !alreadyKnown
          ? adjustSessionListScopeTotal(state.sessionListScopes, owningScope, 1)
          : state.sessionListScopes;
      return {
        ...state,
        sessions: nextSessionsForPath,
        generalSessions:
          state.activeScope.kind === 'general' && listable
            ? nextGeneralSessions
            : state.generalSessions.filter((item) => item.id !== action.sessionId),
        // Mirror the new row into the folder tree for the active project.
        projectSessionsByPath:
          projectPath != null && listable
            ? { ...state.projectSessionsByPath, [projectPath]: nextSessionsForPath }
            : state.projectSessionsByPath,
        sessionListScopes: nextSessionListScopes,
        sessionListMutationEpoch:
          listable && !alreadyKnown
            ? state.sessionListMutationEpoch + 1
            : state.sessionListMutationEpoch,
        activeSessionId: action.sessionId,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: state.streaming ? state.activeSkill : null,
        outline: [],
        activeSessionArchived: false,
        runTerminal: { kind: 'none' },
      };
    }
    case 'session/hydrate': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      const activeProjectPath =
        state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
      return {
        ...state,
        sessions: listable,
        // Keep generalSessions in sync when general is the active scope.
        generalSessions: state.activeScope.kind === 'general' ? listable : state.generalSessions,
        // Keep the sidebar folder tree in sync for the active project.
        projectSessionsByPath:
          activeProjectPath != null
            ? { ...state.projectSessionsByPath, [activeProjectPath]: listable }
            : state.projectSessionsByPath,
        activeSessionId: listable.some((session) => session.id === state.activeSessionId)
          ? state.activeSessionId
          : null,
      };
    }
    case 'session/hydrate-scope': {
      // Drop hydrates that started before a local sidebar admit (first-send
      // name upsert). Otherwise a stale session/list replace erases the live row
      // while activeSessionId is intentionally preserved.
      if (
        action.mutationEpoch !== undefined &&
        action.mutationEpoch !== state.sessionListMutationEpoch
      ) {
        return state;
      }
      const listable = dedupeSessionsById(
        action.sessions.filter((session) => !isPlaceholderSessionName(session.name)),
      );
      const meta = {
        totalCount: action.totalCount,
        truncated: action.truncated,
      };
      const nextSessionListScopes = setSessionListScopeMeta(
        state.sessionListScopes,
        action.scope,
        meta,
      );
      if (action.scope.kind === 'general') {
        return {
          ...state,
          sessionListScopes: nextSessionListScopes,
          generalSessions: listable,
          ...(state.activeScope.kind === 'general'
            ? {
                sessions: listable,
                // Hydration must not deselect the active transcript when the
                // bounded projection does not contain that row.
                activeSessionId: state.activeSessionId,
              }
            : {}),
        };
      }
      const fillsActiveProject =
        action.fillActiveList === true ||
        (state.activeScope.kind === 'project' &&
          state.activeScope.projectPath === action.scope.projectPath);
      return {
        ...state,
        sessionListScopes: nextSessionListScopes,
        projectSessionsByPath: {
          ...state.projectSessionsByPath,
          [action.scope.projectPath]: listable,
        },
        ...(fillsActiveProject
          ? {
              sessions: listable,
              activeSessionId: state.activeSessionId,
            }
          : {}),
      };
    }
    case 'session/hydrate-project': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      return {
        ...state,
        projectSessionsByPath: {
          ...state.projectSessionsByPath,
          [action.projectPath]: listable,
        },
      };
    }
    case 'session/retain-project-paths': {
      const keep = new Set(action.projectPaths);
      if (state.projectPath) {
        keep.add(state.projectPath);
      }
      const keys = Object.keys(state.projectSessionsByPath);
      if (keys.every((projectPath) => keep.has(projectPath))) {
        return state;
      }
      return {
        ...state,
        projectSessionsByPath: retainRecordKeys(state.projectSessionsByPath, [...keep]),
      };
    }
    case 'session/hydrate-general': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      return {
        ...state,
        generalSessions: listable,
        // If general is the active scope, also mirror into sessions so the
        // active session list and activeSessionId stay in sync.
        ...(state.activeScope.kind === 'general'
          ? {
              sessions: listable,
              activeSessionId: listable.some((session) => session.id === state.activeSessionId)
                ? state.activeSessionId
                : null,
            }
          : {}),
      };
    }
    case 'session/update': {
      const sortPinnedThenUpdated = (list: SessionListItemUi[]): SessionListItemUi[] => {
        list.sort((left, right) => {
          const leftPinned = left.isPinned === true;
          const rightPinned = right.isPinned === true;
          if (leftPinned !== rightPinned) {
            return leftPinned ? -1 : 1;
          }
          // Missing updatedAt = just created; keep above stamped rows.
          const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.POSITIVE_INFINITY;
          const rightTime = right.updatedAt
            ? Date.parse(right.updatedAt)
            : Number.POSITIVE_INFINITY;
          const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
          const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
          return rightSafe - leftSafe;
        });
        return list;
      };
      // Resolve ownership from the session itself first, then from whichever
      // sidebar list already tracks it. Never invent ownership from activeScope
      // alone — that is what dual-listed project rows into Conversations.
      const existingForMerge =
        state.sessions.find((session) => session.id === action.session.id) ??
        state.generalSessions.find((session) => session.id === action.session.id) ??
        Object.values(state.projectSessionsByPath)
          .flat()
          .find((session) => session.id === action.session.id);
      const existing = existingForMerge ?? {
        id: action.session.id,
        name: '',
      };
      // Partial index pushes (e.g. created with an empty name) must not erase a
      // listable text/LLM title that already landed via name-updated.
      const patch: SessionListItemUi =
        Object.prototype.hasOwnProperty.call(action.session, 'name') &&
        isPlaceholderSessionName(action.session.name) &&
        !isPlaceholderSessionName(existing.name)
          ? (() => {
              const { name: _ignoredName, ...rest } = action.session;
              return { ...rest, name: existing.name };
            })()
          : { ...action.session };
      const mergedForCheck = {
        ...existing,
        ...patch,
      };
      const listable = !isPlaceholderSessionName(mergedForCheck.name);
      const knownInGeneral = state.generalSessions.some(
        (session) => session.id === action.session.id,
      );
      const knownProjectPath = Object.entries(state.projectSessionsByPath).find(([, list]) =>
        list.some((session) => session.id === action.session.id),
      )?.[0];
      const ownScope = action.session.scope ?? mergedForCheck.scope;
      const ownProjectPath =
        ownScope?.kind === 'project'
          ? ownScope.projectPath
          : action.session.scope?.kind === 'project'
            ? action.session.scope.projectPath
            : undefined;
      const isExplicitGeneral = ownScope?.kind === 'general';
      const isExplicitProject = ownScope?.kind === 'project' || ownProjectPath != null;
      // Project ownership wins over general so a project session cannot leak
      // into Conversations just because general is currently active.
      const owningProjectPath =
        ownProjectPath ??
        knownProjectPath ??
        (!isExplicitGeneral && !knownInGeneral && state.activeScope.kind === 'project'
          ? state.activeScope.projectPath
          : null);
      const belongsToGeneral =
        isExplicitGeneral ||
        (!isExplicitProject &&
          owningProjectPath == null &&
          (knownInGeneral || state.activeScope.kind === 'general'));

      const upsertIntoList = (
        list: SessionListItemUi[],
        shouldOwn: boolean,
      ): SessionListItemUi[] => {
        let next = list.map((session) =>
          session.id === action.session.id ? { ...session, ...patch } : session,
        );
        if (shouldOwn && listable) {
          if (!next.some((session) => session.id === action.session.id)) {
            next.unshift({
              ...patch,
              id: action.session.id,
              name: patch.name ?? mergedForCheck.name,
            });
          }
        } else if (!shouldOwn || !listable) {
          next = next.filter((session) => session.id !== action.session.id);
        }
        return sortPinnedThenUpdated(dedupeSessionsById(next));
      };

      // Active list only receives inserts for sessions that belong to the
      // current scope. Always patch/remove when the id is already present so
      // renames and archive flags stay consistent.
      const activeListOwnsSession =
        state.activeScope.kind === 'general'
          ? belongsToGeneral
          : owningProjectPath != null &&
            state.activeScope.kind === 'project' &&
            state.activeScope.projectPath === owningProjectPath;
      const nextSessions = upsertIntoList(state.sessions, activeListOwnsSession);
      const nextGeneral = upsertIntoList(state.generalSessions, belongsToGeneral);

      const owningScope: SessionScope | null =
        owningProjectPath != null
          ? { kind: 'project', projectPath: owningProjectPath }
          : belongsToGeneral
            ? { kind: 'general' }
            : null;
      const alreadyResident =
        knownInGeneral ||
        knownProjectPath !== undefined ||
        sessionListContainsId(state.sessions, action.session.id);
      const scopeMeta =
        owningScope === null ? null : getSessionListScopeMeta(state.sessionListScopes, owningScope);
      const admitWithoutCounting =
        !alreadyResident &&
        listable &&
        state.activeSessionId === action.session.id &&
        scopeMeta?.truncated === true;
      let nextSessionListScopes = state.sessionListScopes;
      if (owningScope !== null && listable && !alreadyResident && !admitWithoutCounting) {
        nextSessionListScopes = adjustSessionListScopeTotal(nextSessionListScopes, owningScope, 1);
      }
      const nextMutationEpoch =
        listable && !alreadyResident
          ? state.sessionListMutationEpoch + 1
          : state.sessionListMutationEpoch;

      if (owningProjectPath != null) {
        const owned = state.projectSessionsByPath[owningProjectPath] ?? [];
        const nextOwned = upsertIntoList(owned, true);
        // Drop the same id from any other project folders so a re-homed
        // session cannot appear under two project trees at once.
        const nextProjectSessionsByPath: Record<string, SessionListItemUi[]> = {
          ...state.projectSessionsByPath,
          [owningProjectPath]: nextOwned,
        };
        for (const [projectPath, list] of Object.entries(state.projectSessionsByPath)) {
          if (projectPath === owningProjectPath) {
            continue;
          }
          if (list.some((session) => session.id === action.session.id)) {
            nextProjectSessionsByPath[projectPath] = list.filter(
              (session) => session.id !== action.session.id,
            );
          }
        }
        return {
          ...state,
          sessions: nextSessions,
          generalSessions: nextGeneral,
          projectSessionsByPath: nextProjectSessionsByPath,
          sessionListScopes: nextSessionListScopes,
          sessionListMutationEpoch: nextMutationEpoch,
        };
      }
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneral,
        sessionListScopes: nextSessionListScopes,
        sessionListMutationEpoch: nextMutationEpoch,
      };
    }
    case 'session/remove': {
      const nextSessions = state.sessions.filter((session) => session.id !== action.sessionId);
      const nextGeneralSessions = state.generalSessions.filter(
        (session) => session.id !== action.sessionId,
      );
      const nextProjectSessionsByPath = Object.fromEntries(
        Object.entries(state.projectSessionsByPath).map(([projectPath, list]) => [
          projectPath,
          list.filter((session) => session.id !== action.sessionId),
        ]),
      );
      const removedScope = owningScopeFromLists(state, action.sessionId);
      const nextSessionListScopes =
        removedScope === null
          ? state.sessionListScopes
          : adjustSessionListScopeTotal(state.sessionListScopes, removedScope, -1);
      const activeRemoved = state.activeSessionId === action.sessionId;
      const queuedTurnsBySession = { ...state.queuedTurnsBySession };
      const queuedTurnQueueRevisions = { ...state.queuedTurnQueueRevisions };
      delete queuedTurnsBySession[action.sessionId];
      delete queuedTurnQueueRevisions[action.sessionId];
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneralSessions,
        projectSessionsByPath: nextProjectSessionsByPath,
        sessionListScopes: nextSessionListScopes,
        queuedTurnsBySession,
        queuedTurnQueueRevisions,
        warmSessionCache: removeWarmSessionSnapshot(state.warmSessionCache, action.sessionId),
        // Do not auto-select another session when the active one is removed.
        activeSessionId: activeRemoved ? null : state.activeSessionId,
        transcriptOwnerSessionId: activeRemoved ? null : state.transcriptOwnerSessionId,
        messages: activeRemoved ? [] : state.messages,
        transcriptWindow: activeRemoved ? null : state.transcriptWindow,
        historyView: activeRemoved ? null : state.historyView,
        userMessageIndex: activeRemoved ? null : state.userMessageIndex,
        userMessageIndexEpoch: activeRemoved
          ? state.userMessageIndexEpoch + 1
          : state.userMessageIndexEpoch,
        outline: activeRemoved ? [] : state.outline,
        activeSessionArchived: activeRemoved ? false : state.activeSessionArchived,
        awaitingTranscript: activeRemoved ? false : state.awaitingTranscript,
        runPhase: activeRemoved ? 'idle' : state.runPhase,
        activeRunId: activeRemoved ? null : state.activeRunId,
        activeRunPhase: activeRemoved ? null : state.activeRunPhase,
        activeRunStartedAt: activeRemoved ? null : state.activeRunStartedAt,
        streaming: activeRemoved ? false : state.streaming,
        activeSkill: activeRemoved ? null : state.activeSkill,
        runTerminal: activeRemoved ? { kind: 'none' } : state.runTerminal,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
      };
    }
    case 'session/mark-archived-active':
      return {
        ...state,
        activeSessionArchived: action.archived,
      };
    case 'session/hide-from-list': {
      const nextSessions = state.sessions.filter((session) => session.id !== action.sessionId);
      const nextGeneralSessions = state.generalSessions.filter(
        (session) => session.id !== action.sessionId,
      );
      const isActive = state.activeSessionId === action.sessionId;
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneralSessions,
        // Keep activeSessionId/messages so the archived transcript remains visible.
        activeSessionArchived: isActive ? true : state.activeSessionArchived,
      };
    }
    case 'session/clear-active':
      return {
        ...state,
        activeSessionId: null,
        transcriptOwnerSessionId: null,
        // New Agent is only a client-side draft until the first send creates
        // a Host session. Usage belongs to the previous active session and
        // must not leak into the uncreated draft.
        contextUsage: null,
        messages: [],
        transcriptWindow: null,
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        outline: [],
        activeSessionArchived: false,
        awaitingTranscript: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: null,
        runTerminal: { kind: 'none' },
        walkthroughsByMessageId: {},
        ...CLEARED_SUBAGENT_UI,
      };
    case 'session/branch-switched': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      const messages =
        action.clipBeforeMessageId !== undefined
          ? (() => {
              const cut = state.messages.findIndex(
                (message) => message.id === action.clipBeforeMessageId,
              );
              return cut === -1 ? state.messages : state.messages.slice(0, cut);
            })()
          : mapTranscriptMessagesToUi(action.messages ?? []);
      return enforceBoundedTranscriptWindow({
        ...state,
        messages,
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        transcriptWindow: action.transcriptPage
          ? {
              revision: action.transcriptPage.revision,
              totalCount: action.transcriptPage.totalCount,
              ...(action.transcriptPage.olderCursor
                ? { olderCursor: action.transcriptPage.olderCursor }
                : {}),
              retainedBytes: measureTranscriptCacheBytes(messages),
              cacheLimitReached: false,
            }
          : null,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        error: null,
        activeSkill: null,
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        runRecordsById:
          action.clipBeforeMessageId !== undefined
            ? state.runRecordsById
            : buildRunRecordsFromTranscriptMessages(action.messages ?? []),
      });
    }
    case 'user/send': {
      const userMessage: ChatMessageUi = {
        id: action.clientMessageId ?? crypto.randomUUID(),
        role: 'user',
        text: action.text,
        thinking: '',
        tools: [],
        attachments: action.attachments ?? [],
        ...(action.contextRefs && action.contextRefs.length > 0
          ? { contextRefs: action.contextRefs }
          : {}),
        status: 'done',
        createdAt: new Date().toISOString(),
      };
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, userMessage],
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        runPhase: 'streaming',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        streaming: true,
        runTerminal: { kind: 'none' },
        error: null,
        activeSkill: action.skill ?? null,
        pendingTurnModel: action.model ?? state.pendingTurnModel,
        workingSessionIds: state.activeSessionId
          ? { ...state.workingSessionIds, [state.activeSessionId]: true }
          : state.workingSessionIds,
        completedAttentionSessionIds: state.activeSessionId
          ? removeSessionIdMarker(state.completedAttentionSessionIds, state.activeSessionId)
          : state.completedAttentionSessionIds,
      });
    }
    case 'user/steer': {
      const userMessage: ChatMessageUi = {
        id: action.clientMessageId,
        role: 'user',
        text: action.text,
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
        createdAt: new Date().toISOString(),
        ...(action.instructionId && action.targetRunId
          ? {
              runId: action.targetRunId,
              instructionDelivery: {
                kind: 'run-intervention' as const,
                instructionId: action.instructionId,
                status: 'pending' as const,
                targetRunId: action.targetRunId,
                revision: 1,
              },
            }
          : {}),
      };
      // A steer is part of the already-active run. Keep run ownership and
      // phase intact while placing the instruction in the visible chain.
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, userMessage],
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        error: null,
      });
    }
    case 'user/send-rollback': {
      const remainingMessages = state.messages.filter(
        (message) => message.id !== action.clientMessageId,
      );
      if (remainingMessages.length === state.messages.length) {
        return state;
      }
      // Only clear streaming if this optimistic bubble was the latest send and
      // no host run has been accepted yet for the turn.
      const shouldClearStreaming =
        state.streaming && state.activeRunId === null && state.runPhase === 'streaming';
      return {
        ...state,
        messages: remainingMessages,
        pendingTurnModel: shouldClearStreaming ? null : state.pendingTurnModel,
        ...(shouldClearStreaming
          ? {
              runPhase: 'idle' as const,
              streaming: false,
              activeRunPhase: null,
              activeRunPhaseDetail: null,
              activeRunStartedAt: null,
              activeSkill: null,
              workingSessionIds: removeWorkingSessionId(
                state.workingSessionIds,
                state.activeSessionId,
              ),
            }
          : {}),
      };
    }
    case 'run/pausing':
      return {
        ...state,
        runPhase: 'pausing',
        streaming: false,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      };
    case 'run/pause-failed':
      if (state.runPhase !== 'pausing') {
        return state;
      }
      return {
        ...state,
        runPhase: 'streaming',
        streaming: true,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : { ...state.workingSessionIds, [state.activeSessionId]: true },
      };
    case 'run/aborting':
      return {
        ...state,
        runPhase: 'aborting',
        streaming: false,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      };
    case 'run/abort-failed':
      if (state.runPhase !== 'aborting') {
        return state;
      }
      // Abort request failed — run is still live. Re-enable Stop.
      return {
        ...state,
        runPhase: 'streaming',
        streaming: true,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : { ...state.workingSessionIds, [state.activeSessionId]: true },
      };
    case 'run/accepted':
      if (state.activeRunId !== null && state.activeRunId !== action.runId) {
        return state;
      }
      {
        const startedAt = action.acceptedAt ? parseAcceptedAt(action.acceptedAt) : Date.now();
        const previous = state.runRecordsById[action.runId];
        return {
          ...state,
          activeRunId: action.runId,
          activeRunPhase: 'accepted',
          activeRunStartedAt: startedAt,
          lastTerminalRunId: null,
          runPhase: 'streaming',
          streaming: true,
          runTerminal: { kind: 'none' },
          runRecordsById: {
            ...state.runRecordsById,
            [action.runId]: {
              runId: action.runId,
              phaseHistory: previous?.phaseHistory ?? [{ phase: 'accepted', at: startedAt }],
              startedAt: previous?.startedAt ?? startedAt,
              endedAt: previous?.endedAt ?? null,
              ...(previous?.outcome ? { outcome: previous.outcome } : {}),
              ...(previous?.terminalMessage ? { terminalMessage: previous.terminalMessage } : {}),
            },
          },
        };
      }
    case 'foreground/admission':
      return { ...state, foregroundAdmission: action.admission };
    case 'run/updated':
      if (state.activeSessionId !== action.run.sessionId) {
        return applyBackgroundSessionTurnWorkingMarker(state, action.run);
      }
      return applyRunRecord(state, action.run, false);
    case 'run/terminal':
      if (state.activeSessionId !== action.run.sessionId) {
        // Terminal pushes are global. A run can finish after the user has
        // switched sessions, so still clear its background working marker and
        // optionally mark the session as needing attention.
        if (action.run.kind !== 'session-turn') {
          return state;
        }
        const nextWorking = removeWorkingSessionId(state.workingSessionIds, action.run.sessionId);
        // Only completed / failed turns leave a sticky "done" marker. Cancelled
        // and interrupted runs already communicate stop intent and should not
        // keep demanding attention in the sidebar.
        const shouldMarkCompletedAttention =
          action.run.status === 'completed' || action.run.status === 'failed';
        return {
          ...state,
          workingSessionIds: nextWorking,
          completedAttentionSessionIds: shouldMarkCompletedAttention
            ? {
                ...state.completedAttentionSessionIds,
                [action.run.sessionId]: true,
              }
            : removeSessionIdMarker(state.completedAttentionSessionIds, action.run.sessionId),
        };
      }
      {
        const terminalState = applyRunRecord(state, action.run, true);
        return enforceBoundedTranscriptWindow({
          ...terminalState,
          messages: withoutEmptyAssistantPlaceholders(terminalState.messages),
        });
      }
    case 'run/stale-clear': {
      // Reconciliation only ever clears stale liveness; it never invents a
      // terminal outcome. Without an authoritative record the thread returns
      // to its resting state and the sidebar marker drops.
      if (state.activeSessionId !== null && state.activeSessionId !== action.sessionId) {
        return {
          ...state,
          workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        };
      }
      if (state.runPhase === 'idle') {
        return {
          ...state,
          workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        };
      }
      return {
        ...state,
        runPhase: 'idle',
        streaming: false,
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        activeSkill: null,
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
      };
    }
    case 'run/intervention-updated': {
      if (state.activeSessionId !== action.intervention.sessionId) return state;
      const delivery: NonNullable<SessionTranscriptMessage['instructionDelivery']> = {
        kind: 'run-intervention',
        instructionId: action.intervention.interventionId,
        status: action.intervention.status,
        targetRunId: action.intervention.runId,
        revision: action.intervention.revision,
      };
      const messageIndex = state.messages.findIndex(
        (message) => message.id === action.intervention.userMessageId,
      );
      if (messageIndex < 0) return state;
      const messages = [...state.messages];
      const previous = messages[messageIndex];
      if (!previous) return state;
      if (
        previous.instructionDelivery?.kind === 'run-intervention' &&
        previous.instructionDelivery.instructionId === action.intervention.interventionId &&
        previous.instructionDelivery.revision > action.intervention.revision
      ) {
        // Pushes are normally sequenced, but an ACK/replay can race a newer
        // lifecycle push. Intervention revisions are monotonic; never regress
        // an edited, applied, or terminal row to an older projection.
        return state;
      }
      messages[messageIndex] = {
        ...previous,
        text: action.intervention.input.text,
        runId: action.intervention.runId,
        instructionDelivery: delivery,
      };
      return { ...state, messages };
    }
    case 'session/queued-turns-hydrate': {
      const previousRevision = state.queuedTurnQueueRevisions[action.sessionId] ?? -1;
      if (action.queueRevision < previousRevision) return state;
      return {
        ...state,
        queuedTurnsBySession: {
          ...state.queuedTurnsBySession,
          [action.sessionId]: [...action.queuedTurns].sort(
            (left, right) => left.sequence - right.sequence,
          ),
        },
        queuedTurnQueueRevisions: {
          ...state.queuedTurnQueueRevisions,
          [action.sessionId]: action.queueRevision,
        },
      };
    }
    case 'session/queued-turn-updated': {
      const queuedTurn = action.queuedTurn;
      const current = state.queuedTurnsBySession[queuedTurn.sessionId] ?? [];
      const existing = current.find((item) => item.queuedTurnId === queuedTurn.queuedTurnId);
      if (existing && existing.revision > queuedTurn.revision) return state;
      const next = existing
        ? current.map((item) => (item.queuedTurnId === queuedTurn.queuedTurnId ? queuedTurn : item))
        : [...current, queuedTurn];
      let messages = state.messages;
      if (state.activeSessionId === queuedTurn.sessionId) {
        const messageIndex = state.messages.findIndex(
          (message) => message.id === queuedTurn.userMessageId,
        );
        const previous = messageIndex >= 0 ? state.messages[messageIndex] : undefined;
        if (previous !== undefined) {
          const targetRunId = queuedTurn.startedRunId ?? queuedTurn.replaceRunId;
          const instructionDelivery: NonNullable<SessionTranscriptMessage['instructionDelivery']> =
            {
              kind: 'queued-turn',
              instructionId: queuedTurn.queuedTurnId,
              status: queuedTurn.status,
              revision: queuedTurn.revision,
              ...(targetRunId ? { targetRunId } : {}),
            };
          messages = [...state.messages];
          messages[messageIndex] = {
            ...previous,
            text: queuedTurn.input.text,
            ...(queuedTurn.startedRunId ? { runId: queuedTurn.startedRunId } : {}),
            instructionDelivery,
          };
        }
      }
      return {
        ...state,
        messages,
        queuedTurnsBySession: {
          ...state.queuedTurnsBySession,
          [queuedTurn.sessionId]: next.sort((left, right) => left.sequence - right.sequence),
        },
      };
    }
    case 'run/terminal-dismiss':
      return {
        ...state,
        runTerminal: { kind: 'none' },
      };
    case 'session/attention-dismiss':
      return {
        ...state,
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          action.sessionId,
        ),
      };
    case 'host/status':
      return {
        ...state,
        hostReady: action.ready,
        hostMock: action.mock,
        foregroundAdmission: action.ready ? state.foregroundAdmission : 'unknown',
      };
    case 'permission/show':
      if (action.prompt.runId !== undefined && isStaleRunEvent(state, action.prompt.runId)) {
        return state;
      }
      return { ...state, permissionPrompt: action.prompt };
    case 'permission/clear':
      // A resolve response can arrive after the host has already emitted the
      // next MCP permission prompt. Clear only the prompt this response settled.
      return state.permissionPrompt?.requestId === action.requestId
        ? { ...state, permissionPrompt: null }
        : state;
    case 'error':
      return {
        ...state,
        error: action.message,
        activeSkill: null,
        ...(state.activeRunId === null
          ? { runPhase: 'idle' as const, streaming: false }
          : {}),
      };
    case 'error/clear':
      return state.error === null ? state : { ...state, error: null };
    case 'compaction/dismiss':
      return {
        ...state,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
      };
    case 'reply-writer/updated': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      if (!state.messages.some((message) => message.id === action.messageId)) {
        return state;
      }
      return updateMessage(state, action.messageId, (message) => {
        if (action.status === 'started') {
          return { ...message, replyWriterPending: true };
        }
        if (action.status === 'failed') {
          return { ...message, replyWriterPending: false };
        }
        return {
          ...message,
          replyWriterPending: false,
          ...(action.model && action.language
            ? { replyWriter: { model: action.model, language: action.language } }
            : {}),
        };
      });
    }
    case 'transcript/append': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      if (state.messages.some((item) => item.id === action.message.id)) {
        if (!action.message.model) {
          return state;
        }
        return {
          ...state,
          messages: state.messages.map((item) => {
            if (item.id === action.message.id && !item.model && action.message.model) {
              return {
                ...item,
                model: action.message.model,
                ...(action.message.createdAt && !item.createdAt
                  ? { createdAt: action.message.createdAt }
                  : {}),
              };
            }
            return item;
          }),
        };
      }
      const [nextMessage] = mapTranscriptMessagesToUi([action.message], {
        keepStreamingStatus: true,
      });
      if (!nextMessage) {
        return state;
      }
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, nextMessage],
        userMessageIndex:
          action.message.role === 'user' &&
          typeof action.message.text === 'string' &&
          action.message.text.trim().length > 0
            ? null
            : state.userMessageIndex,
        userMessageIndexEpoch:
          action.message.role === 'user' &&
          typeof action.message.text === 'string' &&
          action.message.text.trim().length > 0
            ? state.userMessageIndexEpoch + 1
            : state.userMessageIndexEpoch,
      });
    }
    case 'event':
      if (state.activeSessionId !== action.sessionId || state.awaitingTranscript) {
        return state;
      }
      if (isStaleByEnvelope(state, action)) {
        return state;
      }
      return applyAgentEvent(recordEventEnvelope(state, action), action.event);
    case 'event/batch': {
      if (state.activeSessionId !== action.sessionId || state.awaitingTranscript) {
        return state;
      }
      // C1: process batch events individually, checking each for envelope staleness
      let currentState = state;
      const envelopes = action.envelopes ?? [];
      for (let index = 0; index < action.events.length; index++) {
        const batchEvent = action.events[index];
        if (!batchEvent) {
          continue;
        }
        const batchEnvelope = envelopes[index];
        if (batchEnvelope && isEnvelopeStale(currentState, batchEnvelope)) {
          continue;
        }
        if (batchEnvelope) {
          currentState = recordEnvelope(currentState, batchEnvelope);
        }
        currentState = applyAgentEvent(currentState, batchEvent);
      }
      return currentState;
    }
    case 'subagent/stream': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      if (action.envelope && isEnvelopeStale(state, action.envelope)) {
        return state;
      }
      const acceptedState = action.envelope ? recordEnvelope(state, action.envelope) : state;
      return applySubagentStreamEvent(acceptedState, action.childSessionId, action.event);
    }
    case 'subagent/updated': {
      // Cross-session guard: child lifecycle pushes for a non-active parent
      // must not leak into the visible children map.
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const child = action.child;
      const nextChildren = { ...state.subagentChildren, [child.id]: child };
      return {
        ...state,
        subagentChildren: evictCompletedFirst(
          nextChildren,
          MAX_SUBAGENT_CHILDREN,
          isTerminalSubagentChild,
        ),
      };
    }
    case 'subagent/invocation-updated': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const current = state.subagentInvocations[action.invocation.id];
      if (current && current.revision >= action.invocation.revision) {
        return state;
      }
      return {
        ...state,
        subagentInvocations: evictCompletedFirst(
          {
            ...state.subagentInvocations,
            [action.invocation.id]: action.invocation,
          },
          MAX_SUBAGENT_INVOCATIONS,
          isTerminalSubagentInvocation,
        ),
      };
    }
    case 'subagent/children-hydrate': {
      // Hydrate upserts only children of the active parent; summaries for
      // other parents are intentionally ignored at the application boundary.
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const nextChildren = { ...state.subagentChildren };
      for (const child of action.children) {
        nextChildren[child.id] = child;
      }
      return {
        ...state,
        subagentChildren: evictCompletedFirst(
          nextChildren,
          MAX_SUBAGENT_CHILDREN,
          isTerminalSubagentChild,
        ),
      };
    }
    case 'subagent/invocations-hydrate': {
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const nextInvocations = { ...state.subagentInvocations };
      for (const invocation of action.invocations) {
        const current = nextInvocations[invocation.id];
        if (!current || current.revision < invocation.revision) {
          nextInvocations[invocation.id] = invocation;
        }
      }
      return {
        ...state,
        subagentInvocations: evictCompletedFirst(
          nextInvocations,
          MAX_SUBAGENT_INVOCATIONS,
          isTerminalSubagentInvocation,
        ),
      };
    }
    case 'subagent/batch-updated': {
      if (state.activeSessionId !== action.parentSessionId) return state;
      return {
        ...state,
        subagentBatches: putRecordLru(
          state.subagentBatches,
          action.runId,
          action.result,
          MAX_SUBAGENT_BATCHES,
        ),
      };
    }
    case 'subagent/task-updated': {
      if (state.activeSessionId !== action.parentSessionId) return state;
      const key = `${action.runId}:${action.result.taskId}`;
      return {
        ...state,
        subagentTaskResults: putRecordLru(
          state.subagentTaskResults,
          key,
          action.result,
          MAX_SUBAGENT_TASK_RESULTS,
        ),
      };
    }
    case 'subagent/clear-stream': {
      if (!(action.childSessionId in state.subagentStreams)) {
        return state;
      }
      const nextStreams = { ...state.subagentStreams };
      delete nextStreams[action.childSessionId];
      return { ...state, subagentStreams: nextStreams };
    }
    case 'walkthrough/hydrate': {
      // While the previous session's rows are still painted, ignore hydrate so
      // walkthrough chips cannot attach to the wrong transcript.
      if (state.awaitingTranscript) {
        return state;
      }
      const walkthroughsByMessageId: Record<string, WalkthroughArtifact> = {};
      for (const artifact of action.artifacts) {
        walkthroughsByMessageId[artifact.messageId] = artifact;
      }
      return { ...state, walkthroughsByMessageId };
    }
    case 'walkthrough/updated': {
      // Cross-session guard: a walkthrough generation that completes for
      // session B must not leak into session A's map after the user has
      // switched away. Only accept pushes for the active session.
      if (state.activeSessionId !== action.artifact.sessionId) return state;
      const existing = state.walkthroughsByMessageId[action.artifact.messageId];
      // Only drop a `generating` push when a *different* generation is still
      // in flight — that is a stale late push from an old generation. A
      // `generating` push against a terminal (ready/error) artifact represents
      // a fresh regeneration request (e.g. the user clicked Regenerate) and
      // must be accepted so the UI shows "Generating...". Terminal pushes
      // (ready/error) always update.
      if (
        existing &&
        existing.status === 'generating' &&
        action.artifact.status === 'generating' &&
        existing.generationId !== action.artifact.generationId
      ) {
        return state;
      }
      return {
        ...state,
        walkthroughsByMessageId: {
          ...state.walkthroughsByMessageId,
          [action.artifact.messageId]: action.artifact,
        },
      };
    }
    case 'walkthrough/remove': {
      if (!(action.messageId in state.walkthroughsByMessageId)) {
        return state;
      }
      const nextWalkthroughs = { ...state.walkthroughsByMessageId };
      delete nextWalkthroughs[action.messageId];
      return { ...state, walkthroughsByMessageId: nextWalkthroughs };
    }
    default:
      return state;
  }
}

export function chatUiReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
  const next = chatUiReducerCore(state, action);
  if (next === state) {
    return state;
  }
  return refreshActiveSessionMetadata(state, next);
}

/**
 * Apply a child session AgentEvent to the inline subagent stream state.
 * Accumulates text/thinking deltas and tool lifecycle for live expand UX.
 */
/**
 * Move the current live message of a stream into `completedSegments`.
 * No-op when the current message is empty or has no identity.
 */
function finishCurrentSubagentSegment(stream: SubagentStreamState): SubagentStreamState {
  if (stream.currentMessageId === null) {
    return stream;
  }
  const boundedText = createBoundedTextAccumulator(stream.text, {
    maximumBytes: MAX_RETAINED_SUBAGENT_SEGMENT_TEXT_BYTES,
    truncationMarker: STREAMING_TEXT_TRUNCATION_MARKER,
  });
  const boundedThinking = createBoundedTextAccumulator(stream.thinking, {
    maximumBytes: MAX_RETAINED_SUBAGENT_SEGMENT_THINKING_BYTES,
    truncationMarker: STREAMING_THINKING_TRUNCATION_MARKER,
  });
  const segment: SubagentStreamSegment = {
    messageId: stream.currentMessageId,
    text: boundedText.text,
    thinking: boundedThinking.text,
    tools: stream.tools,
    ...(boundedText.truncated || boundedThinking.truncated ? { truncated: true } : {}),
    ...(stream.attachments && stream.attachments.length > 0
      ? { attachments: stream.attachments }
      : {}),
    ...(stream.searchEvidence ? { searchEvidence: stream.searchEvidence } : {}),
  };
  const { searchEvidence: _droppedEvidence, ...streamWithoutEvidence } = stream;
  return {
    ...streamWithoutEvidence,
    completedSegments: [...stream.completedSegments, segment].slice(-MAX_SUBAGENT_STREAM_SEGMENTS),
    completionRevision: stream.completionRevision + 1,
    text: '',
    textRetainedBytes: 0,
    textTruncated: false,
    thinking: '',
    thinkingRetainedBytes: 0,
    thinkingTruncated: false,
    truncated: false,
    tools: [],
    attachments: [],
  };
}

/**
 * Attach a tool patch to the completed segment owning `responseMessageId`.
 * Returns null when no completed segment owns that message.
 */
function patchCompletedSegmentTool(
  stream: SubagentStreamState,
  responseMessageId: string,
  patch: (tools: SubagentStreamTool[]) => SubagentStreamTool[],
): SubagentStreamState | null {
  const index = stream.completedSegments.findIndex(
    (segment) => segment.messageId === responseMessageId,
  );
  if (index < 0) {
    return null;
  }
  const segment = stream.completedSegments[index];
  if (!segment) {
    return null;
  }
  const completedSegments = [...stream.completedSegments];
  completedSegments[index] = { ...segment, tools: patch(segment.tools) };
  return { ...stream, completedSegments };
}

function mergeAttachmentsById(
  current: readonly PromptAttachment[] | undefined,
  incoming: readonly PromptAttachment[],
): PromptAttachment[] {
  const merged = [...(current ?? [])];
  for (const attachment of incoming) {
    if (!merged.some((candidate) => candidate.id === attachment.id)) {
      merged.push(attachment);
    }
  }
  return merged;
}

/**
 * Attach tool-produced media to the message that owns `toolCallId`, matching
 * where `patchSubagentToolWherever` placed the tool itself.
 */
function mergeSubagentToolAttachments(
  stream: SubagentStreamState,
  toolCallId: string,
  attachments: readonly PromptAttachment[],
): SubagentStreamState {
  if (attachments.length === 0) {
    return stream;
  }
  if (!stream.tools.some((tool) => tool.toolCallId === toolCallId)) {
    for (let index = stream.completedSegments.length - 1; index >= 0; index -= 1) {
      const segment = stream.completedSegments[index];
      if (segment && segment.tools.some((tool) => tool.toolCallId === toolCallId)) {
        const completedSegments = [...stream.completedSegments];
        completedSegments[index] = {
          ...segment,
          attachments: mergeAttachmentsById(segment.attachments, attachments),
        };
        return { ...stream, completedSegments };
      }
    }
  }
  return { ...stream, attachments: mergeAttachmentsById(stream.attachments, attachments) };
}

/**
 * Apply a tool patch wherever the toolCallId currently lives: the live
 * message first, then completed segments (newest first). Tools finish after
 * their owning message ends, so updates routinely target retained segments.
 */
function patchSubagentToolWherever(
  stream: SubagentStreamState,
  toolCallId: string,
  patch: (tools: SubagentStreamTool[]) => SubagentStreamTool[],
): SubagentStreamState {
  if (stream.tools.some((tool) => tool.toolCallId === toolCallId)) {
    return { ...stream, tools: patch(stream.tools) };
  }
  for (let index = stream.completedSegments.length - 1; index >= 0; index -= 1) {
    const segment = stream.completedSegments[index];
    if (segment && segment.tools.some((tool) => tool.toolCallId === toolCallId)) {
      const completedSegments = [...stream.completedSegments];
      completedSegments[index] = { ...segment, tools: patch(segment.tools) };
      return { ...stream, completedSegments };
    }
  }
  // Unknown toolCallId: patch the live tools (per-tool maps are no-ops there,
  // matching the previous silent-skip behavior).
  return { ...stream, tools: patch(stream.tools) };
}

function applySubagentStreamEvent(
  state: ChatUiState,
  childSessionId: string,
  event: AgentEvent,
): ChatUiState {
  const existing = state.subagentStreams[childSessionId] ?? {
    childSessionId,
    completedSegments: [],
    completionRevision: 0,
    text: '',
    textRetainedBytes: 0,
    textTruncated: false,
    thinking: '',
    thinkingRetainedBytes: 0,
    thinkingTruncated: false,
    truncated: false,
    tools: [],
    attachments: [],
    streaming: false,
    currentMessageId: null,
    permissionPrompt: null,
  };

  switch (event.type) {
    case 'message/start': {
      if (event.role !== 'assistant') return state;
      // Defensive: a missing message/end must not drop the previous message.
      const settled = finishCurrentSubagentSegment(existing);
      const { searchEvidence: _previousSearchEvidence, ...streamWithoutSearchEvidence } = settled;
      const updated: SubagentStreamState = {
        ...streamWithoutSearchEvidence,
        streaming: true,
        currentMessageId: event.messageId,
        text: '',
        textRetainedBytes: 0,
        textTruncated: false,
        thinking: '',
        thinkingRetainedBytes: 0,
        thinkingTruncated: false,
        truncated: false,
        tools: [],
        attachments: [],
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/text_delta': {
      const nextText = appendBoundedLiveText(
        {
          text: existing.text,
          retainedBytes: existing.textRetainedBytes,
          truncated: existing.textTruncated,
        },
        event.delta,
        STREAMING_TEXT_RETENTION_OPTIONS,
      );
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        text: nextText.text,
        textRetainedBytes: nextText.retainedBytes,
        textTruncated: nextText.truncated,
        ...(nextText.truncated || existing.truncated ? { truncated: true } : {}),
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/text_snapshot': {
      const boundedText = createBoundedTextAccumulator(
        event.text,
        STREAMING_TEXT_RETENTION_OPTIONS,
      );
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        text: boundedText.text,
        textRetainedBytes: boundedText.retainedBytes,
        textTruncated: boundedText.truncated,
        ...(boundedText.truncated || existing.truncated ? { truncated: true } : {}),
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/thinking_delta': {
      const nextThinking = appendBoundedLiveText(
        {
          text: existing.thinking,
          retainedBytes: existing.thinkingRetainedBytes,
          truncated: existing.thinkingTruncated,
        },
        event.delta,
        STREAMING_THINKING_RETENTION_OPTIONS,
      );
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        thinking: nextThinking.text,
        thinkingRetainedBytes: nextThinking.retainedBytes,
        thinkingTruncated: nextThinking.truncated,
        ...(nextThinking.truncated || existing.truncated ? { truncated: true } : {}),
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/end': {
      // The finished message becomes a retained segment so later messages of
      // the same child cannot erase it from an open child-session window.
      const settled = finishCurrentSubagentSegment(existing);
      const updated: SubagentStreamState = {
        ...settled,
        streaming: false,
        currentMessageId: null,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/search_evidence': {
      const updated: SubagentStreamState = {
        ...existing,
        searchEvidence: existing.searchEvidence
          ? mergeSearchEvidence(existing.searchEvidence, event.evidence)
          : event.evidence,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/start': {
      const tool: SubagentStreamTool = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        output: '',
        outputRetainedBytes: 0,
        outputTruncated: false,
        ...(event.presentation ? { presentation: event.presentation } : {}),
        ...(event.runId ? { runId: event.runId } : {}),
        ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
      };
      // Causal order delivers a message's tools after its message/end. When
      // the owning response is already a completed segment, the tool belongs
      // there — not on the next live message.
      if (event.responseMessageId && event.responseMessageId !== existing.currentMessageId) {
        const patched = patchCompletedSegmentTool(existing, event.responseMessageId, (tools) => {
          const index = tools.findIndex((t) => t.toolCallId === event.toolCallId);
          if (index >= 0) {
            const next = [...tools];
            next[index] = tool;
            return next;
          }
          return [...tools, tool];
        });
        if (patched) {
          return {
            ...state,
            subagentStreams: { ...state.subagentStreams, [childSessionId]: patched },
          };
        }
      }
      const tools = [...existing.tools];
      const existingIdx = tools.findIndex((t) => t.toolCallId === event.toolCallId);
      if (existingIdx >= 0) {
        tools[existingIdx] = tool;
      } else {
        tools.push(tool);
      }
      const updated: SubagentStreamState = { ...existing, tools };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/update': {
      const applyUpdate = (tools: SubagentStreamTool[]): SubagentStreamTool[] =>
        tools.map((tool) => {
          if (tool.toolCallId !== event.toolCallId) {
            return tool;
          }
          const output = appendBoundedToolOutput(tool, event.delta);
          return {
            ...tool,
            output: output.text,
            outputRetainedBytes: output.retainedBytes,
            outputTruncated: output.truncated,
            ...(event.presentation ? { presentation: event.presentation } : {}),
            ...(event.runId ? { runId: event.runId } : {}),
            ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
          };
        });
      const updated = patchSubagentToolWherever(existing, event.toolCallId, applyUpdate);
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/end': {
      const applyEnd = (tools: SubagentStreamTool[]): SubagentStreamTool[] =>
        tools.map((t) =>
          t.toolCallId === event.toolCallId
            ? {
                ...t,
                status: (event.isError ? 'error' : 'done') as 'done' | 'error',
                ...(event.presentation ? { presentation: event.presentation } : {}),
                ...(event.runId ? { runId: event.runId } : {}),
                ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
              }
            : t,
        );
      const withTools = patchSubagentToolWherever(existing, event.toolCallId, applyEnd);
      // Tool output lands on whichever message owns the call. For a finished
      // message that is a completed segment, so attachments must follow the
      // tool there — the live buffer is cleared by the next message/start.
      const updated = mergeSubagentToolAttachments(
        withTools,
        event.toolCallId,
        event.attachments ?? [],
      );
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'session/aborted':
    case 'session/ended': {
      const updated: SubagentStreamState = {
        ...existing,
        streaming: false,
        permissionPrompt: null,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'permission/request': {
      const updated: SubagentStreamState = {
        ...existing,
        permissionPrompt: {
          requestId: event.requestId,
          sessionId: childSessionId,
          ...(event.runId ? { runId: event.runId } : {}),
          action: event.action,
          detail: event.detail,
          defaultDecision: event.defaultDecision,
          ...(event.context ? { context: event.context } : {}),
        },
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'permission/resolved': {
      if (existing.permissionPrompt?.requestId !== event.requestId) return state;
      const updated: SubagentStreamState = { ...existing, permissionPrompt: null };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    default:
      return state;
  }
}

// ---- C1: Envelope-based dedup helpers ----

/**
 * Extract the run key for sequence tracking from an envelope.
 * Uses runId when present, otherwise "_global".
 */
function envelopeRunKey(envelope: AgentEventEnvelope): string {
  return envelope.runId ?? '_global';
}

/**
 * Check whether an envelope represents a stale or replayed event.
 */
function isEnvelopeStale(state: ChatUiState, envelope: AgentEventEnvelope): boolean {
  // Replay: eventId already seen
  if (state.receivedEventIds.has(envelope.eventId)) {
    return true;
  }
  // Stale: sequence not advancing
  const runKey = envelopeRunKey(envelope);
  const lastSeq = state.lastAcceptedSequenceByRun[runKey] ?? 0;
  if (envelope.sequence <= lastSeq) {
    return true;
  }
  return false;
}

/**
 * Record an envelope into the dedup state (bounded eventId ring + max sequence).
 */
function recordEnvelope(state: ChatUiState, envelope: AgentEventEnvelope): ChatUiState {
  const runKey = envelopeRunKey(envelope);
  const lastSeq = state.lastAcceptedSequenceByRun[runKey] ?? 0;

  let nextReceivedEventIds = state.receivedEventIds;
  if (!nextReceivedEventIds.has(envelope.eventId)) {
    nextReceivedEventIds = new Set(nextReceivedEventIds);
    nextReceivedEventIds.add(envelope.eventId);
    // Bounded ring: drop oldest when over limit (Set keeps insertion order).
    if (nextReceivedEventIds.size > MAX_RETAINED_EVENT_IDS) {
      let toDrop = EVENT_ID_TRIM_BATCH;
      for (const oldestId of nextReceivedEventIds) {
        if (toDrop <= 0) break;
        nextReceivedEventIds.delete(oldestId);
        toDrop -= 1;
      }
    }
  }

  return {
    ...state,
    receivedEventIds: nextReceivedEventIds,
    lastAcceptedSequenceByRun: {
      ...state.lastAcceptedSequenceByRun,
      [runKey]: Math.max(lastSeq, envelope.sequence),
    },
  };
}

/**
 * Extract optional envelope from an event action and check for staleness.
 * Returns true when the event should be dropped.
 */
function isStaleByEnvelope(
  state: ChatUiState,
  action: { event: AgentEvent } & Record<string, unknown>,
): boolean {
  const envelope = action.envelope as AgentEventEnvelope | undefined;
  if (!envelope) {
    return false;
  }
  return isEnvelopeStale(state, envelope);
}

/**
 * Record the envelope from an event action into dedup state.
 * Returns the updated state (unchanged when no envelope present).
 */
function recordEventEnvelope(
  state: ChatUiState,
  action: { event: AgentEvent } & Record<string, unknown>,
): ChatUiState {
  const envelope = action.envelope as AgentEventEnvelope | undefined;
  if (!envelope) {
    return state;
  }
  return recordEnvelope(state, envelope);
}

/** Remove a session ID from a marker set, returning a new record. */
function removeSessionIdMarker(
  markers: Record<string, true>,
  sessionId: string | null,
): Record<string, true> {
  if (!sessionId || !(sessionId in markers)) {
    return markers;
  }
  const next = { ...markers };
  delete next[sessionId];
  return next;
}

/** Remove a session ID from the working set, returning a new record. */
function removeWorkingSessionId(
  working: Record<string, true>,
  sessionId: string | null,
): Record<string, true> {
  return removeSessionIdMarker(working, sessionId);
}

/**
 * Background `run/updated` must not paint another session's transcript, but it
 * still owns the sidebar spinner. Host may publish a terminal-shaped update
 * without a following `run/terminal` after the user has already switched away.
 */
function applyBackgroundSessionTurnWorkingMarker(
  state: ChatUiState,
  run: ExecutionRunRecord,
): ChatUiState {
  if (run.kind !== 'session-turn') {
    return state;
  }
  const stopWorking =
    isRunTerminal(run.status) || run.status === 'cancelling' || run.phase === 'pausing';
  if (stopWorking) {
    const nextWorking = removeWorkingSessionId(state.workingSessionIds, run.sessionId);
    const shouldMarkCompletedAttention = run.status === 'completed' || run.status === 'failed';
    const nextAttention: Record<string, true> = shouldMarkCompletedAttention
      ? { ...state.completedAttentionSessionIds, [run.sessionId]: true }
      : removeSessionIdMarker(state.completedAttentionSessionIds, run.sessionId);
    if (
      nextWorking === state.workingSessionIds &&
      nextAttention === state.completedAttentionSessionIds
    ) {
      return state;
    }
    return {
      ...state,
      workingSessionIds: nextWorking,
      completedAttentionSessionIds: nextAttention,
    };
  }
  if (run.status !== 'queued' && run.status !== 'running') {
    return state;
  }
  if (run.sessionId in state.workingSessionIds) {
    return state;
  }
  return {
    ...state,
    workingSessionIds: { ...state.workingSessionIds, [run.sessionId]: true },
  };
}

/**
 * Pause/Stop stay sticky until Host terminals the Run or the request fails.
 * Later live events (message/start, message/end, still-running run/updated)
 * must not put the sidebar spinner or "thinking" chrome back on.
 */
function isUserControlInFlight(state: ChatUiState): boolean {
  return (
    state.runPhase === 'pausing' ||
    state.runPhase === 'aborting' ||
    state.activeRunPhase === 'pausing'
  );
}

/**
 * Prefer the in-flight turn model, then the active session list row. Host
 * should also enrich `message/start`; these fallbacks keep Conversation's
 * provider avatar after streaming when that enrichment is missing.
 */
function resolveAssistantModelFallback(state: ChatUiState): ModelRef | undefined {
  if (state.pendingTurnModel) {
    return state.pendingTurnModel;
  }
  const sessionId = state.activeSessionId;
  if (sessionId === null) return undefined;
  const fromLists =
    state.sessions.find((session) => session.id === sessionId)?.model ??
    state.generalSessions.find((session) => session.id === sessionId)?.model;
  if (fromLists) return fromLists;
  for (const sessions of Object.values(state.projectSessionsByPath)) {
    const match = sessions.find((session) => session.id === sessionId)?.model;
    if (match) return match;
  }
  return undefined;
}

/** Pi ends the tool-call assistant row before tool/start. Keep it until the next answer. */
function isEmptyAssistantPlaceholder(message: ChatMessageUi): boolean {
  return (
    message.status !== 'streaming' &&
    message.status !== 'error' &&
    !message.error &&
    message.failure === undefined &&
    isAssistantContentEmpty(message)
  );
}

function withoutFailureEvidence(message: ChatMessageUi): ChatMessageUi {
  if (message.error === undefined && message.failure === undefined && message.status !== 'error') {
    return message;
  }
  const { error: _error, failure: _failure, ...rest } = message;
  return {
    ...rest,
    status: message.status === 'error' ? 'done' : message.status,
  };
}

function withoutEmptyAssistantPlaceholders(messages: readonly ChatMessageUi[]): ChatMessageUi[] {
  return messages.filter((message) => !isEmptyAssistantPlaceholder(message));
}

function applyAgentEvent(state: ChatUiState, event: AgentEvent): ChatUiState {
  switch (event.type) {
    case 'message/start': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (event.role !== 'assistant') {
        return state;
      }
      // Host reconnects or duplicate SDK subscriptions may replay lifecycle
      // start events. A message id identifies one assistant bubble.
      if (state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      const resolvedRunId = event.runId ?? state.activeRunId ?? undefined;
      const resolvedModel = event.model ?? resolveAssistantModelFallback(state);
      const controlInFlight = isUserControlInFlight(state);
      const message: ChatMessageUi = {
        id: event.messageId,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'streaming',
        ...(resolvedRunId ? { runId: resolvedRunId } : {}),
        ...(resolvedModel ? { model: resolvedModel } : {}),
      };
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...withoutEmptyAssistantPlaceholders(state.messages), message],
        runPhase: controlInFlight ? state.runPhase : 'streaming',
        ...(event.runId
          ? {
              activeRunId: event.runId,
              activeRunPhase: controlInFlight
                ? state.activeRunPhase
                : ('streaming' as const),
            }
          : {}),
        streaming: !controlInFlight,
        runTerminal: { kind: 'none' },
      });
    }
    case 'message/text_delta':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        // Do not manufacture empty assistant rows for a delta whose lifecycle
        // start was lost or belongs to an older subscription.
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        const nextMessage =
          event.delta.length > 0 ? finishMessageThinking(message, Date.now()) : message;
        const nextText = appendBoundedLiveText(
          {
            text: message.text,
            retainedBytes: message.textRetainedBytes,
            truncated: message.textTruncated,
          },
          event.delta,
          STREAMING_TEXT_RETENTION_OPTIONS,
        );
        return {
          ...nextMessage,
          text: nextText.text,
          textRetainedBytes: nextText.retainedBytes,
          textTruncated: nextText.truncated,
          ...(nextText.truncated || message.uiTruncated ? { uiTruncated: true } : {}),
          status: 'streaming',
        };
      });
    /** C1: complete text snapshot replaces, not appends. */
    case 'message/text_snapshot':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        const nextMessage =
          event.text.length > 0 ? finishMessageThinking(message, Date.now()) : message;
        const boundedText = createBoundedTextAccumulator(
          event.text,
          STREAMING_TEXT_RETENTION_OPTIONS,
        );
        return {
          ...nextMessage,
          text: boundedText.text,
          textRetainedBytes: boundedText.retainedBytes,
          textTruncated: boundedText.truncated,
          ...(boundedText.truncated || message.uiTruncated ? { uiTruncated: true } : {}),
          status: message.status,
        };
      });
    case 'message/thinking_delta':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => {
        const nextMessage =
          event.delta.length > 0 ? startMessageThinking(message, Date.now()) : message;
        const nextThinking = appendBoundedLiveText(
          {
            text: message.thinking,
            retainedBytes: message.thinkingRetainedBytes,
            truncated: message.thinkingTruncated,
          },
          event.delta,
          STREAMING_THINKING_RETENTION_OPTIONS,
        );
        return {
          ...nextMessage,
          thinking: nextThinking.text,
          thinkingRetainedBytes: nextThinking.retainedBytes,
          thinkingTruncated: nextThinking.truncated,
          ...(nextThinking.truncated || message.uiTruncated ? { uiTruncated: true } : {}),
        };
      });
    case 'message/search_evidence': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        searchEvidence: mergeSearchEvidence(message.searchEvidence, event.evidence),
      }));
    }
    case 'message/end': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const fallbackModel = resolveAssistantModelFallback(state);
      const next = updateMessage(state, event.messageId, (message) => ({
        ...finishMessageThinking(message, Date.now()),
        status: 'done' as const,
        // After streaming, Conversation stops using livePromptModel. If Host
        // omitted the snapshot on message/start, keep the turn/session model
        // so the provider avatar does not disappear on completion.
        ...(message.model === undefined && fallbackModel !== undefined
          ? { model: fallbackModel }
          : {}),
      }));
      // Pi ends the Assistant row that carries a tool call before
      // tool_execution_start. Keep that empty row so tool/start can attach;
      // ChatMessageRow hides it, and the next assistant message/start prunes
      // leftovers that never received tools (see store-transcript-recorder).
      const hasRunningTool = next.messages.some((message) =>
        message.tools.some((tool) => tool.status === 'running'),
      );
      if (event.runId !== undefined || state.activeRunId !== null) {
        const controlInFlight = isUserControlInFlight(state);
        return enforceBoundedTranscriptWindow({
          ...next,
          activeRunPhase: controlInFlight
            ? state.activeRunPhase
            : hasRunningTool
              ? 'tool-running'
              : (state.activeRunPhase ?? 'streaming'),
          runPhase: controlInFlight
            ? state.runPhase
            : state.runPhase === 'idle'
              ? 'streaming'
              : state.runPhase,
          streaming: !controlInFlight,
        });
      }
      return enforceBoundedTranscriptWindow({
        ...next,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: null,
        runTerminal: hasRunningTool ? next.runTerminal : { kind: 'complete', at: Date.now() },
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
        // Legacy events without a runId are accepted only for the active
        // session, whose completed response is already visible in the window.
        completedAttentionSessionIds: removeSessionIdMarker(
          state.completedAttentionSessionIds,
          state.activeSessionId,
        ),
      });
    }
    case 'session/aborted': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const messageId = event.messageId;
      const thinkingEndedAt = Date.now();
      const nextMessages = messageId
        ? state.messages.map((message) =>
            message.id === messageId
              ? {
                  ...finishMessageThinking(message, thinkingEndedAt),
                  status: 'done' as const,
                }
              : message,
          )
        : state.messages.map((message) =>
            message.status === 'streaming'
              ? {
                  ...finishMessageThinking(message, thinkingEndedAt),
                  status: 'done' as const,
                }
              : message,
          );
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: nextMessages,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: event.runId ?? null,
        streaming: false,
        activeSkill: null,
        runTerminal: { kind: 'stopped', at: Date.now() },
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      });
    }
    case 'tool/start': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const ownerMessage = findAssistantMessageForToolStart(
        state,
        event.runId,
        event.responseMessageId,
      );
      if (!ownerMessage) {
        return state;
      }
      return updateMessage(state, ownerMessage.id, (message) => {
        if (message.tools.length >= MAX_TOOL_CARDS_PER_MESSAGE) {
          // Card budget exhausted: skip this card rather than grow a
          // protected live message without bound.
          return message;
        }
        const output = createBoundedToolOutput(event.presentation?.output?.text ?? '');
        return {
          ...finishMessageThinking(message, Date.now()),
          tools: [
            ...message.tools,
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: 'running',
              output: output.text,
              outputRetainedBytes: output.retainedBytes,
              outputTruncated: output.truncated,
              ...(event.presentation
                ? {
                    presentation: projectBoundedToolPresentation(event.presentation, output),
                  }
                : {}),
              ...(event.runId ? { runId: event.runId } : {}),
              ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
            },
          ],
        };
      });
    }
    case 'tool/update':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      return updateOwnedTool(
        state,
        event.toolCallId,
        event.runId,
        event.responseMessageId,
        (tool) => {
          const output =
            event.presentation?.output?.text !== undefined
              ? createBoundedToolOutput(event.presentation.output.text)
              : appendBoundedToolOutput(tool, event.delta);
          const mergedPresentation = event.presentation
            ? mergeToolPresentation(tool.presentation, event.presentation)
            : tool.presentation;
          return {
            ...tool,
            output: output.text,
            outputRetainedBytes: output.retainedBytes,
            outputTruncated: output.truncated,
            ...(mergedPresentation
              ? { presentation: projectBoundedToolPresentation(mergedPresentation, output) }
              : {}),
            ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
          };
        },
      );
    case 'tool/end':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      {
        const updatedState = updateOwnedTool(
          state,
          event.toolCallId,
          event.runId,
          event.responseMessageId,
          (tool) => {
            const mergedPresentation = event.presentation
              ? mergeToolPresentation(tool.presentation, event.presentation)
              : tool.presentation;
            const displayOutput =
              mergedPresentation?.output?.text !== undefined
                ? mergedPresentation.output.text
                : tool.output;
            const output = createBoundedToolOutput(displayOutput);
            return {
              ...tool,
              status: event.isError ? 'error' : 'done',
              output: output.text,
              outputRetainedBytes: output.retainedBytes,
              outputTruncated: output.truncated,
              ...(event.responseMessageId ? { responseMessageId: event.responseMessageId } : {}),
              ...(mergedPresentation
                ? { presentation: projectBoundedToolPresentation(mergedPresentation, output) }
                : {}),
            };
          },
        );
        if (!event.attachments || event.attachments.length === 0) {
          return updatedState;
        }
        return appendGeneratedAttachmentsToToolOwner(
          updatedState,
          event.toolCallId,
          event.runId,
          event.responseMessageId,
          event.attachments,
        );
      }
    case 'permission/request': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      // Normalized event path (in addition to HostPush permission/request).
      // sessionId is not on AgentEvent; bind to the active session.
      if (!state.activeSessionId) {
        return state;
      }
      return {
        ...state,
        permissionPrompt: {
          requestId: event.requestId,
          sessionId: state.activeSessionId,
          action: event.action,
          detail: event.detail,
          defaultDecision: event.defaultDecision,
          ...(event.runId ? { runId: event.runId } : {}),
          ...(event.context ? { context: event.context } : {}),
        },
      };
    }
    case 'permission/resolved': {
      if (state.permissionPrompt?.requestId !== event.requestId) {
        return state;
      }
      return { ...state, permissionPrompt: null };
    }
    case 'compaction/start':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      return {
        ...state,
        compacting: true,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
        lastCompactionFileOps: null,
      };
    case 'compaction/end': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const message =
        typeof event.message === 'string' && event.message
          ? event.message
          : event.ok === false
            ? 'Compaction finished with errors'
            : 'Context compacted';
      const fileOps = 'fileOps' in event && event.fileOps ? event.fileOps : null;
      const contextUsage =
        event.ok !== false && typeof event.tokensAfter === 'number' && state.contextUsage
          ? {
              ...state.contextUsage,
              tokensUsed: event.tokensAfter,
              totalTokens: event.tokensAfter,
              ...(typeof state.contextUsage.tokensLimit === 'number' &&
              state.contextUsage.tokensLimit > 0
                ? { contextRatio: event.tokensAfter / state.contextUsage.tokensLimit }
                : {}),
              updatedAt: new Date().toISOString(),
              source: 'pi-contextUsage' as const,
            }
          : state.contextUsage;
      return {
        ...state,
        contextUsage,
        compacting: false,
        lastCompactionMessage: message,
        lastCompactionSummary:
          typeof event.summary === 'string' && event.summary ? event.summary : null,
        lastCompactionTokensBefore:
          typeof event.tokensBefore === 'number' ? event.tokensBefore : null,
        lastCompactionTokensAfter: typeof event.tokensAfter === 'number' ? event.tokensAfter : null,
        lastCompactionDurationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
        lastCompactionFileOps: fileOps,
      };
    }
    case 'usage/update':
      if (!shouldAcceptContextUsage(state.contextUsage, event.usage)) {
        return state;
      }
      return { ...state, contextUsage: event.usage };
    case 'model/retry':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (isUserControlInFlight(state) || event.phase === 'finished') {
        return state;
      }
      return {
        ...state,
        ...(event.runId !== undefined ? { activeRunId: event.runId } : {}),
        activeRunPhase: 'connecting-model',
        runPhase: 'streaming',
        streaming: true,
      };
    case 'error':
      // Evidence only. Run terminal status comes from run/terminal.
      if (event.runId === undefined) {
        return state;
      }
      if (state.activeRunId !== null && state.activeRunId !== event.runId) {
        return state;
      }
      if (
        state.activeRunId === null &&
        state.lastTerminalRunId !== null &&
        state.lastTerminalRunId !== event.runId
      ) {
        return state;
      }
      {
        const errorMessage = event.message.trim() || 'Run failed';
        const targetRunId = event.runId;
        const controlInFlight = isUserControlInFlight(state);
        if (controlInFlight) {
          return {
            ...state,
            error: null,
            streaming: false,
            compacting: false,
            activeSkill: null,
            workingSessionIds: removeWorkingSessionId(
              state.workingSessionIds,
              state.activeSessionId,
            ),
          };
        }
        const lastOutcome = state.runRecordsById[targetRunId]?.outcome;
        if (lastOutcome === 'cancelled' || lastOutcome === 'paused') {
          return state;
        }
        const runAlreadyFailed =
          state.activeRunId === null &&
          state.lastTerminalRunId === targetRunId &&
          lastOutcome === 'failed';
        const failureProjection = markLatestAssistantFailure(
          state.messages,
          targetRunId,
          errorMessage,
          true,
          false,
          {
            ...(event.failure === undefined ? {} : { failure: event.failure }),
            stampStatus: runAlreadyFailed,
          },
        );
        return {
          ...state,
          messages: failureProjection.messages,
        };
      }
    default:
      return state;
  }
}

function isStaleRunEvent(state: ChatUiState, runId: string): boolean {
  // Only drop frames that belong to a different live run. Trailing deltas
  // for a run can sit in the paint buffer when `run/terminal` used to
  // dispatch in the same JS turn; treating them as stale hid the whole reply
  // until transcript hydrate dumped it.
  return state.activeRunId !== null && state.activeRunId !== runId;
}

/** Reduce the authoritative top-level RunHostPush projection. */
function applyRunRecord(
  state: ChatUiState,
  run: ExecutionRunRecord,
  isTerminalEvent: boolean,
): ChatUiState {
  const previousRecord = state.runRecordsById[run.runId];
  if (previousRecord !== undefined && !isTerminalEvent) {
    if (
      run.revision !== undefined &&
      previousRecord.revision !== undefined &&
      run.revision <= previousRecord.revision
    ) {
      return state;
    }
    if (run.revision === undefined && isLegacyRunProjectionEqual(previousRecord, run)) {
      return state;
    }
  }
  const phaseAt = parseEventTime(run.phaseUpdatedAt ?? run.startedAt ?? run.endedAt ?? '');
  const lastPhase = previousRecord?.phaseHistory.at(-1);
  const phaseHistory =
    run.phase !== undefined &&
    (lastPhase?.phase !== run.phase || lastPhase.detail !== run.phaseDetail)
      ? [
          ...(previousRecord?.phaseHistory ?? []),
          {
            phase: run.phase,
            at: phaseAt,
            ...(run.phaseDetail ? { detail: run.phaseDetail } : {}),
          },
        ]
      : (previousRecord?.phaseHistory ?? []);
  const outcome =
    run.status === 'completed'
      ? ('completed' as const)
      : run.status === 'interrupted' && run.terminalCode === 'paused'
        ? ('paused' as const)
        : run.status === 'cancelled' || run.status === 'interrupted'
          ? ('cancelled' as const)
          : run.status === 'failed'
            ? ('failed' as const)
            : undefined;
  const nextRecord: RunRecordUi = {
    runId: run.runId,
    ...(run.revision !== undefined
      ? { revision: run.revision }
      : previousRecord?.revision !== undefined
        ? { revision: previousRecord.revision }
        : {}),
    status: run.status,
    ...(run.phase !== undefined
      ? { phase: run.phase }
      : previousRecord?.phase !== undefined
        ? { phase: previousRecord.phase }
        : {}),
    ...(run.phaseDetail !== undefined
      ? { phaseDetail: run.phaseDetail }
      : previousRecord?.phaseDetail !== undefined
        ? { phaseDetail: previousRecord.phaseDetail }
        : {}),
    phaseHistory,
    startedAt: run.startedAt ? parseEventTime(run.startedAt) : (previousRecord?.startedAt ?? null),
    endedAt: run.endedAt ? parseEventTime(run.endedAt) : (previousRecord?.endedAt ?? null),
    ...(outcome ? { outcome } : previousRecord?.outcome ? { outcome: previousRecord.outcome } : {}),
    ...(run.error
      ? { terminalMessage: run.error }
      : previousRecord?.terminalMessage
        ? { terminalMessage: previousRecord.terminalMessage }
        : {}),
  };
  const records = { ...state.runRecordsById, [run.runId]: nextRecord };

  if (run.kind !== 'session-turn') {
    return { ...state, runRecordsById: records };
  }
  if (outcome === undefined) {
    if (state.activeRunId === null && state.lastTerminalRunId === run.runId) {
      return { ...state, runRecordsById: records };
    }
    if (
      state.activeRunId !== null &&
      state.activeRunId !== run.runId &&
      run.status === 'cancelling'
    ) {
      return { ...state, runRecordsById: records };
    }
    // Pause and Stop both enter cancelling. Never revive the sidebar spinner or
    // streaming chrome while control is in flight — later abort errors used to
    // clear it, then a still-running run/updated put it right back before Host
    // had acknowledged the pause.
    const controlPending =
      run.status === 'cancelling' ||
      run.phase === 'pausing' ||
      isUserControlInFlight(state);
    return {
      ...state,
      activeRunId: run.runId,
      activeRunPhase: run.phase ?? state.activeRunPhase,
      activeRunPhaseDetail: run.phaseDetail ?? null,
      activeRunStartedAt: run.startedAt ? parseEventTime(run.startedAt) : state.activeRunStartedAt,
      runPhase:
        run.phase === 'pausing' || state.runPhase === 'pausing'
          ? 'pausing'
          : run.status === 'cancelling' || state.runPhase === 'aborting'
            ? 'aborting'
            : 'streaming',
      streaming: !controlPending,
      lastTerminalRunId: null,
      runTerminal: { kind: 'none' },
      workingSessionIds: controlPending
        ? removeWorkingSessionId(state.workingSessionIds, run.sessionId)
        : { ...state.workingSessionIds, [run.sessionId]: true },
      runRecordsById: records,
    };
  }

  if (state.activeRunId !== null && state.activeRunId !== run.runId) {
    return { ...state, runRecordsById: records };
  }
  if (
    state.activeRunId === null &&
    state.lastTerminalRunId !== null &&
    state.lastTerminalRunId !== run.runId
  ) {
    return { ...state, runRecordsById: records };
  }
  if (state.activeRunId === null && state.lastTerminalRunId === run.runId) {
    return state;
  }
  const errorMessage = outcome === 'failed' ? run.error?.trim() || 'Run failed' : undefined;
  let messages = state.messages;
  if (outcome !== 'failed') {
    messages = messages.map((message) =>
      message.runId === run.runId ? withoutFailureEvidence(message) : message,
    );
  }
  if (errorMessage !== undefined) {
    const failureProjection = markLatestAssistantFailure(
      state.messages,
      run.runId,
      errorMessage,
      false,
      true,
      run.failure === undefined ? undefined : { failure: run.failure },
    );
    messages = failureProjection.messages;
    if (!failureProjection.stamped) {
      let lastAssistantIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'assistant') {
          lastAssistantIndex = index;
          break;
        }
      }
      if (lastAssistantIndex >= 0) {
        messages = messages.map((message, index) =>
          index === lastAssistantIndex
            ? {
                ...message,
                status: 'error' as const,
                error: message.error ?? errorMessage,
                ...(message.runId === undefined ? { runId: run.runId } : {}),
                ...(run.failure === undefined ? {} : { failure: run.failure }),
              }
            : message,
        );
      } else {
        messages = [
          ...messages,
          {
            id: `piw-m-error-${run.runId}`,
            role: 'assistant',
            text: '',
            thinking: '',
            tools: [],
            attachments: [],
            status: 'error',
            error: errorMessage,
            runId: run.runId,
            ...(run.failure === undefined ? {} : { failure: run.failure }),
          },
        ];
      }
    }
  }
  return {
    ...state,
    messages,
    activeRunId: null,
    activeRunPhase: null,
    activeRunPhaseDetail: null,
    activeRunStartedAt: null,
    lastTerminalRunId: run.runId,
    runPhase: 'idle',
    streaming: false,
    activeSkill: null,
    pendingTurnModel: null,
    permissionPrompt: state.permissionPrompt?.runId === run.runId ? null : state.permissionPrompt,
    error: outcome === 'failed' ? (run.error ?? 'Run failed') : state.error,
    runTerminal:
      outcome === 'paused'
        ? {
            kind: 'paused',
            at: Date.now(),
            ...(run.resumeCheckpointId ? { checkpointId: run.resumeCheckpointId } : {}),
          }
        : outcome === 'cancelled'
          ? { kind: 'stopped', at: Date.now() }
          : outcome === 'failed'
            ? { kind: 'failed', message: run.error ?? 'Run failed', at: Date.now() }
            : { kind: 'complete', at: Date.now() },
    runRecordsById: records,
    workingSessionIds: removeWorkingSessionId(state.workingSessionIds, run.sessionId),
    // Host implementations may publish a terminal-shaped `run/updated`
    // immediately before `run/terminal`; derive the sidebar cue here so both
    // delivery forms have identical completion behavior. The active session
    // is already visible, so only a background session needs the cue.
    completedAttentionSessionIds:
      (outcome === 'completed' || outcome === 'failed') && state.activeSessionId !== run.sessionId
        ? { ...state.completedAttentionSessionIds, [run.sessionId]: true }
        : removeSessionIdMarker(state.completedAttentionSessionIds, run.sessionId),
  };
}

function isLegacyRunProjectionEqual(previous: RunRecordUi, run: ExecutionRunRecord): boolean {
  const outcome =
    run.status === 'completed'
      ? 'completed'
      : run.status === 'cancelled' || run.status === 'interrupted'
        ? 'cancelled'
        : run.status === 'failed'
          ? 'failed'
          : undefined;
  const previousOutcome = previous.outcome;
  const previousStartedAt = previous.startedAt;
  const previousEndedAt = previous.endedAt;
  const nextStartedAt = run.startedAt ? parseEventTime(run.startedAt) : null;
  const nextEndedAt = run.endedAt ? parseEventTime(run.endedAt) : null;
  const nextTerminalMessage = run.error;

  return (
    previous.status === run.status &&
    previous.phase === run.phase &&
    previous.phaseDetail === run.phaseDetail &&
    previousOutcome === outcome &&
    previousStartedAt === nextStartedAt &&
    previousEndedAt === nextEndedAt &&
    previous.terminalMessage === nextTerminalMessage
  );
}

function isStaleOptionalRunEvent(state: ChatUiState, runId: string | undefined): boolean {
  if (runId !== undefined) {
    return isStaleRunEvent(state, runId);
  }
  // Legacy foreground events have no run identity. Once a terminal state is
  // visible, accepting one would reopen a completed run in the transcript.
  return state.lastTerminalRunId !== null;
}

function parseAcceptedAt(acceptedAt: string): number {
  const parsedAt = Date.parse(acceptedAt);
  return Number.isFinite(parsedAt) ? parsedAt : Date.now();
}

function parseEventTime(eventTime: string): number {
  const parsedAt = Date.parse(eventTime);
  return Number.isFinite(parsedAt) ? parsedAt : Date.now();
}

function buildRunRecordsFromTranscriptMessages(
  messages: SessionTranscriptMessage[],
): Record<string, RunRecordUi> {
  const records: Record<string, RunRecordUi> = {};
  for (const message of messages) {
    if (!message.runId) {
      continue;
    }
    const existingRecord = records[message.runId];
    const phaseHistory = (message.phaseHistory ?? []).map((entry) => ({
      phase: entry.phase,
      at: parseEventTime(entry.at),
      ...(entry.detail ? { detail: entry.detail } : {}),
    }));
    records[message.runId] = {
      runId: message.runId,
      phaseHistory,
      startedAt: message.startedAt
        ? parseEventTime(message.startedAt)
        : (existingRecord?.startedAt ?? null),
      endedAt: message.endedAt
        ? parseEventTime(message.endedAt)
        : (existingRecord?.endedAt ?? null),
      ...(message.outcome
        ? { outcome: message.outcome }
        : existingRecord?.outcome
          ? { outcome: existingRecord.outcome }
          : {}),
      ...(message.terminalMessage
        ? { terminalMessage: message.terminalMessage }
        : existingRecord?.terminalMessage
          ? { terminalMessage: existingRecord.terminalMessage }
          : {}),
    };
  }
  return records;
}

function updateMessage(
  state: ChatUiState,
  messageId: string,
  updater: (message: ChatMessageUi) => ChatMessageUi,
): ChatUiState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId ? updater(message) : message,
    ),
  };
}

function startMessageThinking(message: ChatMessageUi, startedAt: number): ChatMessageUi {
  if (message.thinkingStartedAt !== undefined) {
    return message;
  }
  return { ...message, thinkingStartedAt: startedAt };
}

function finishMessageThinking(message: ChatMessageUi, endedAt: number): ChatMessageUi {
  if (message.thinkingStartedAt === undefined || message.thinkingEndedAt !== undefined) {
    return message;
  }
  return {
    ...message,
    thinkingEndedAt: Math.max(message.thinkingStartedAt, endedAt),
  };
}

/**
 * Prefer the assistant message that owns this run; fall back only for legacy
 * events without runId to the latest assistant bubble still streaming/open.
 */
function findAssistantMessageForToolStart(
  state: ChatUiState,
  runId: string | undefined,
  responseMessageId: string | undefined,
): ChatMessageUi | undefined {
  if (responseMessageId !== undefined) {
    return state.messages.find(
      (message) => message.role === 'assistant' && message.id === responseMessageId,
    );
  }
  if (runId !== undefined) {
    const byRun = [...state.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.runId === runId);
    if (byRun) {
      return byRun;
    }
    // Active run may have started before message/start linked runId — use the
    // latest assistant that is still streaming when it matches the active run.
    if (state.activeRunId === runId) {
      return [...state.messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' &&
            message.runId === undefined &&
            message.status === 'streaming',
        );
    }
    return undefined;
  }
  return [...state.messages].reverse().find((message) => message.role === 'assistant');
}

/** Update a tool only on the owning message/run, never the first global match. */
function updateOwnedTool(
  state: ChatUiState,
  toolCallId: string,
  runId: string | undefined,
  responseMessageId: string | undefined,
  updater: (tool: ToolCardUi) => ToolCardUi,
): ChatUiState {
  let matched = false;
  const nextMessages = state.messages.map((message) => {
    if (matched) {
      return message;
    }
    if (responseMessageId !== undefined && message.id !== responseMessageId) {
      return message;
    }
    const toolIndex = message.tools.findIndex((tool) => {
      if (tool.toolCallId !== toolCallId) {
        return false;
      }
      if (runId === undefined) {
        return true;
      }
      // Prefer tools that recorded the same run; also allow tools that predate run tagging.
      return tool.runId === undefined || tool.runId === runId;
    });
    if (toolIndex < 0) {
      return message;
    }
    if (runId !== undefined && message.runId !== undefined && message.runId !== runId) {
      return message;
    }
    if (
      runId !== undefined &&
      message.runId === undefined &&
      (state.activeRunId !== runId || message.status !== 'streaming')
    ) {
      return message;
    }
    matched = true;
    return {
      ...message,
      tools: message.tools.map((tool, index) => (index === toolIndex ? updater(tool) : tool)),
    };
  });
  if (!matched) {
    return state;
  }
  return { ...state, messages: nextMessages };
}

/** Add generated media to the assistant message that owns the tool call. */
function appendGeneratedAttachmentsToToolOwner(
  state: ChatUiState,
  toolCallId: string,
  runId: string | undefined,
  responseMessageId: string | undefined,
  attachments: readonly MediaAttachmentRef[],
): ChatUiState {
  let matched = false;
  const nextMessages = state.messages.map((message) => {
    if (matched) {
      return message;
    }
    if (responseMessageId !== undefined && message.id !== responseMessageId) {
      return message;
    }
    const toolMatches = message.tools.some(
      (tool) =>
        tool.toolCallId === toolCallId &&
        (runId === undefined || tool.runId === undefined || tool.runId === runId),
    );
    if (!toolMatches) {
      return message;
    }
    if (runId !== undefined && message.runId !== undefined && message.runId !== runId) {
      return message;
    }
    if (
      runId !== undefined &&
      message.runId === undefined &&
      (state.activeRunId !== runId || message.status !== 'streaming')
    ) {
      return message;
    }

    matched = true;
    const existingIds = new Set(message.attachments.map((attachment) => attachment.id));
    const nextAttachments = [...message.attachments];
    for (const attachment of attachments) {
      if (!existingIds.has(attachment.id)) {
        existingIds.add(attachment.id);
        nextAttachments.push(attachment);
      }
    }
    return { ...message, attachments: nextAttachments };
  });

  return matched ? { ...state, messages: nextMessages } : state;
}

/**
 * True when a tool presentation summary is a raw JSON/args dump (including
 * clipSummary-truncated dumps that no longer end with `}` / `]`).
 */
function isJsonishToolSummary(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function mergeToolPresentation(
  existing: ToolPresentation | undefined,
  incoming: ToolPresentation,
): ToolPresentation {
  if (!existing) {
    return incoming;
  }
  const merged: ToolPresentation = {
    ...existing,
    ...incoming,
    ...(incoming.output || existing.output
      ? {
          output: {
            text: incoming.output?.text ?? existing.output?.text ?? '',
            ...(incoming.output?.truncated || existing.output?.truncated
              ? { truncated: true as const }
              : {}),
            ...(incoming.output?.redacted || existing.output?.redacted
              ? { redacted: true as const }
              : {}),
          },
        }
      : {}),
    ...(incoming.error || existing.error ? { error: incoming.error ?? existing.error } : {}),
  };
  const targetPaths = incoming.targetPaths ?? existing.targetPaths;
  const changedPaths = incoming.changedPaths ?? existing.changedPaths;
  if (targetPaths !== undefined) {
    merged.targetPaths = targetPaths;
  }
  if (changedPaths !== undefined) {
    merged.changedPaths = changedPaths;
  }
  // tool/end often rebuilds presentation without args (image_gen → paths JSON).
  // Keep the start-time human summary and inputPreview instead of the dump.
  if (
    existing.summary &&
    incoming.summary &&
    isJsonishToolSummary(incoming.summary) &&
    !isJsonishToolSummary(existing.summary)
  ) {
    merged.summary = existing.summary;
  } else if (existing.summary && !incoming.summary) {
    merged.summary = existing.summary;
  }
  if (existing.inputPreview && !incoming.inputPreview) {
    merged.inputPreview = existing.inputPreview;
  }
  return merged;
}

const SECRET_DISPLAY_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
];

/** Best-effort display redaction for tool deltas that reach the Desktop path. */
function redactDisplayText(text: string): string {
  let next = text;
  for (const pattern of SECRET_DISPLAY_PATTERNS) {
    next = next.replace(pattern, '[redacted]');
  }
  return next;
}

function createBoundedToolOutput(value: string): BoundedTextAccumulator {
  return createBoundedTextAccumulator(redactDisplayText(value), TOOL_OUTPUT_RETENTION_OPTIONS);
}

/** Keep structured presentation from retaining an uncapped duplicate output string. */
function projectBoundedToolPresentation(
  presentation: ToolPresentation,
  output: BoundedTextAccumulator,
): ToolPresentation {
  if (!presentation.output) {
    return presentation;
  }
  return {
    ...presentation,
    output: {
      ...presentation.output,
      text: output.text,
      ...(output.truncated ? { truncated: true } : {}),
    },
  };
}

function appendBoundedToolOutput(
  tool: Pick<ToolCardUi, 'output' | 'outputRetainedBytes' | 'outputTruncated'>,
  nextDelta: string,
): BoundedTextAccumulator {
  const accumulator =
    tool.outputRetainedBytes === undefined || tool.outputTruncated === undefined
      ? createBoundedToolOutput(tool.output)
      : {
          text: tool.output,
          retainedBytes: tool.outputRetainedBytes,
          truncated: tool.outputTruncated,
        };
  return appendBoundedText(
    accumulator,
    redactDisplayText(nextDelta),
    TOOL_OUTPUT_RETENTION_OPTIONS,
  );
}
