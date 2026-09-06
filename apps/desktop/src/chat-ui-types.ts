import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentFailure,
  AgentModeId,
  AssistantUsageMeasurement,
  ContextUsageSnapshot,
  ExecutionRunRecord,
  RunInterventionRecord,
  QueuedTurnRecord,
  ModelRef,
  PromptAttachment,
  PromptContextRef,
  PermissionDecision,
  PermissionRequestContext,
  SessionPauseCheckpoint,
  SessionContextSnapshot,
  SessionRunOutcome,
  SessionRunPhase,
  SessionScope,
  CompactionReason,
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
import type { SessionListScopeState } from './session-list-scope';
import type { WarmSessionCache } from './session-warm-cache';
import type { ContextTelemetryState } from './context-telemetry-reducer';

export const MAX_TOOL_CARDS_PER_MESSAGE = 128;

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
  /** Live tool-call argument progress; omitted after tool/start. */
  toolArgsProgress?: {
    argumentCharCount: number;
    toolName?: string;
  };
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
  source?: SessionTranscriptMessage['source'];
  voiceCallId?: string;
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
  /**
   * Collaboration mode this user turn was sent under. Only stamped on user
   * rows, and only by the live send path — resumed history has no stamp, so
   * Goal display falls back to a heuristic (goal/goal-session-model.ts).
   */
  agentMode?: AgentModeId;
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
  /** Concurrent child-session permission requests, head shown as `permissionPrompt`. */
  permissionQueue?: PermissionPromptUi[];
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

export type CompactionActivityPhase = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Transcript-bound projection of one context compaction operation. */
export type CompactionActivityUi = {
  operationId: string;
  phase: CompactionActivityPhase;
  reason: CompactionReason;
  anchorMessageId: string | null;
  startedAt: number;
  endedAt?: number;
  runId?: string;
  message?: string;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  durationMs?: number;
  fileOps?: {
    readFiles: string[];
    modifiedFiles: string[];
    omittedCount?: number;
  };
  willRetry?: boolean;
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
  /**
   * Canonical session identity keyed by id. Unnamed rows stay here so a later
   * name patch cannot guess the current page's scope.
   */
  sessionEntitiesById: Record<string, SessionListItemUi>;
  /** Deleted ids that in-flight hydrates must not resurrect. */
  sessionTombstonesById: Record<string, true>;
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
   * warm hit → that session's rows; cold → empty placeholder until Host load.
   * New empty sessions leave this false (no load-messages is coming).
   */
  awaitingTranscript: boolean;
  /**
   * Session that owns the rows currently painted in `messages`. Cold switches
   * clear the previous body, so this should match `activeSessionId` unless a
   * draft send is still painting optimistic user rows. Derived actions verify
   * this field before combining a message id with the selected session.
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
  /** Timestamp of the latest Host phase transition for the active run. */
  activeRunPhaseUpdatedAt: number | null;
  lastTerminalRunId: string | null;
  streaming: boolean;
  runTerminal: RunTerminalState;
  /** True while model context compaction is running. */
  compacting: boolean;
  /** Current/last compaction activity, rendered inline in the transcript chain. */
  compactionActivity?: CompactionActivityUi | null | undefined;
  hostReady: boolean;
  hostMock: boolean;
  permissionPrompt: PermissionPromptUi | null;
  /**
   * Concurrent permission requests. `permissionPrompt` is the queue head so
   * existing readers keep working; the reducer is the only writer of both.
   */
  permissionQueue: PermissionPromptUi[];
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
  /** Host occupancy snapshot for the selected session; independent of transcript load. */
  contextTelemetry: ContextTelemetryState;
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
   * Session IDs whose latest session-turn failed while the user was looking
   * elsewhere. Tracked separately from `completedAttentionSessionIds` so the
   * sidebar's ink-line node can distinguish "done" from "failed" (Inkstone
   * six-state vocabulary) instead of collapsing both into one green mark.
   * Same lifecycle as the completed marker: cleared on open or dismissal.
   */
  failedAttentionSessionIds: Record<string, true>;
  /**
   * Frozen composer model for the in-flight turn. Stamped onto assistant rows
   * when Host omits `message/start.model`. Historic headers must not read the
   * live composer selection.
   */
  pendingTurnModel: ModelRef | null;
};

export type ChatUiAction =
  | { type: 'scope/set'; scope: SessionScope }
  | { type: 'project/set'; path: string; trusted: boolean; keepActiveSession?: boolean }
  | { type: 'project/clear'; keepActiveSession?: boolean }
  | { type: 'project/trust-dialog'; open: boolean }
  | { type: 'project/trusted' }
  | { type: 'session/set'; sessionId: string; awaitTranscript?: boolean; ifIdle?: boolean }
  | { type: 'session/add'; sessionId: string; name: string; scope?: SessionScope }
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
  | { type: 'session/hydrate-error'; scope: SessionScope; error: string }
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
      /** Active Host pause checkpoint restored with the transcript. */
      pauseCheckpoint?: SessionPauseCheckpoint;
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
  /** `restore` revives a tombstoned id after Host unarchive. */
  | { type: 'session/update'; session: SessionListItemUi; restore?: true }
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
      /** Optimistic clip: keep this id, drop everything after it (retry). */
      clipAfterMessageId?: string;
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
      /**
       * Collaboration mode this turn was sent under. Goal display reads it to
       * find the objective that armed the loop; see goal/goal-session-model.ts.
       */
      agentMode?: AgentModeId;
    }
  | {
      type: 'user/steer';
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
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
  | { type: 'run/accepted'; runId: string; sessionId?: string; acceptedAt?: string }
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
  | { type: 'permission/reconcile'; permissions: PermissionPromptUi[] }
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
  | { type: 'walkthrough/remove'; messageId: string }
  | {
      type: 'context-telemetry/snapshot';
      snapshot: SessionContextSnapshot;
      source?: 'hydrate' | 'live' | 'replay';
      hostInstanceId?: string | null;
    }
  | {
      type: 'context-telemetry/last-request';
      sessionId: string;
      usage: AssistantUsageMeasurement | null;
    }
  | { type: 'context-telemetry/capability'; supported: boolean }
  | { type: 'context-telemetry/disconnect' }
  | { type: 'context-telemetry/reconnect' }
  | { type: 'context-telemetry/host-instance'; hostInstanceId: string | null }
  | { type: 'context-telemetry/invalidate'; sessionId: string };
