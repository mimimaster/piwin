import { isPlaceholderSessionName } from './title-display';
import type {
  AgentEvent,
  AgentEventEnvelope,
  ContextUsageSnapshot,
  ExecutionRunRecord,
  MediaAttachmentRef,
  PromptAttachment,
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
  SubagentTaskResult,
  ToolPresentation,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { SessionOutlineNode } from '@piwin/contracts';
import {
  mergeSearchEvidence,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  shouldAcceptContextUsage,
} from '@piwin/contracts';
import { extractUserFacingBody } from '@piwin/session/derive-default-name';
import {
  appendBoundedText,
  createBoundedTextAccumulator,
  type BoundedTextAccumulator,
} from './bounded-text-accumulator';
import { GENERAL_SESSION_PAGE_SIZE, PROJECT_SESSION_PAGE_SIZE } from './session-sidebar-page';
import { SESSION_LIST_WINDOW_MAX_PAGES } from './session-list-page-state';
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

const MAX_RETAINED_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';
const GENERAL_SESSION_WINDOW_MAX_ITEMS = GENERAL_SESSION_PAGE_SIZE * SESSION_LIST_WINDOW_MAX_PAGES;
const PROJECT_SESSION_WINDOW_MAX_ITEMS = PROJECT_SESSION_PAGE_SIZE * SESSION_LIST_WINDOW_MAX_PAGES;
const TOOL_OUTPUT_RETENTION_OPTIONS = {
  maximumBytes: MAX_RETAINED_TOOL_OUTPUT_BYTES,
  truncationMarker: TOOL_OUTPUT_TRUNCATION_MARKER,
} as const;

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
};

export type ChatMessageUi = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  thinking: string;
  tools: ToolCardUi[];
  attachments: PromptAttachment[];
  status: 'streaming' | 'done' | 'error';
  searchEvidence?: SearchEvidence;
  createdAt?: string;
  /** Run that produced this assistant message when host provided run identity. */
  runId?: string;
  subagentActivity?: SubagentActivityView;
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
};

export type SubagentStreamState = {
  childSessionId: string;
  /** Accumulated assistant text deltas from the child session. */
  text: string;
  /** Accumulated thinking deltas from the child session. */
  thinking: string;
  /** Tool calls observed in the child session. */
  tools: SubagentStreamTool[];
  /** Whether the child session is currently streaming. */
  streaming: boolean;
  /** Last message id seen from the child (for delta accumulation). */
  currentMessageId: string | null;
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
  /** True after Desktop migrates list ownership to bounded Host pages. */
  sessionListsWindowed: boolean;
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
   * idle | streaming | aborting — replaces overloaded boolean for Stop UI.
   * `streaming` remains true for both streaming and aborting so existing guards keep working.
   */
  runPhase: 'idle' | 'streaming' | 'aborting';
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
   * New entries are appended; when the array exceeds MAX_RETAINED_EVENT_IDS
   * the oldest EVENT_ID_TRIM_BATCH entries are dropped.
   * Cleared on session switch.
   */
  receivedEventIds: string[];
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
   * Session IDs that currently have an active run (streaming / tool-running).
   * Survives session switches so the sidebar can show a working indicator
   * on sessions that are running in the background.
   */
  workingSessionIds: Record<string, true>;
  /**
   * Session IDs whose latest session-turn finished while the user was looking
   * elsewhere. Sidebar shows a dismissible completed marker until the user
   * opens the session (or the marker is cleared explicitly).
   */
  completedAttentionSessionIds: Record<string, true>;
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
      type: 'session/hydrate-page';
      scope: SessionScope;
      sessions: SessionListItemUi[];
      fillActiveList?: boolean;
    }
  | {
      type: 'session/hydrate-project';
      projectPath: string;
      sessions: SessionListItemUi[];
    }
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
  | { type: 'session/update'; session: SessionListItemUi }
  | { type: 'session/remove'; sessionId: string }
  | { type: 'session/mark-archived-active'; archived: boolean }
  | { type: 'session/hide-from-list'; sessionId: string }
  | { type: 'session/clear-active' }
  | {
      type: 'session/truncate';
      sessionId: string;
      messages: SessionTranscriptMessage[];
      transcriptPage?: SessionTranscriptPageInfo;
    }
  | {
      type: 'user/send';
      text: string;
      attachments?: PromptAttachment[];
      /** Client-generated id so failed sends can roll back the optimistic bubble. */
      clientMessageId?: string;
      /** Skill selected by the composer, if this prompt used `/skill`. */
      skill?: SkillActivityView;
    }
  | {
      type: 'user/steer';
      text: string;
      /** Client-generated id shared with Host transcript persistence. */
      clientMessageId: string;
    }
  | { type: 'user/send-rollback'; clientMessageId: string }
  | { type: 'run/aborting' }
  | { type: 'run/accepted'; runId: string; acceptedAt?: string }
  | { type: 'run/updated'; run: ExecutionRunRecord }
  | { type: 'run/terminal'; run: ExecutionRunRecord }
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
      type: 'subagent/stream';
      parentSessionId: string;
      childSessionId: string;
      event: AgentEvent;
    }
  | { type: 'subagent/clear-stream'; childSessionId: string }
  | { type: 'subagent/updated'; parentSessionId: string; child: SessionSummary }
  | {
      type: 'subagent/children-hydrate';
      parentSessionId: string;
      children: SessionSummary[];
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
    sessionListsWindowed: false,
    activeSessionId: null,
    messages: [],
    warmSessionCache: createEmptyWarmSessionCache(),
    transcriptWindow: null,
    historyView: null,
    userMessageIndex: null,
    userMessageIndexEpoch: 0,
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
    receivedEventIds: [],
    lastAcceptedSequenceByRun: {},
    runRecordsById: {},
    subagentStreams: {},
    subagentChildren: {},
    subagentBatches: {},
    subagentTaskResults: {},
    walkthroughsByMessageId: {},
    workingSessionIds: {},
    completedAttentionSessionIds: {},
  };
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
    text: message.role === 'user' ? extractUserFacingBody(message.text) : message.text,
    thinking: message.thinking ?? '',
    tools: (message.tools ?? []).map((tool) => {
      const output = createBoundedToolOutput(tool.presentation?.output?.text ?? tool.output);
      return {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        status: tool.status,
        output: output.text,
        outputRetainedBytes: output.retainedBytes,
        outputTruncated: output.truncated,
        ...(tool.runId ? { runId: tool.runId } : {}),
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
    ...(message.subagentActivity ? { subagentActivity: message.subagentActivity } : {}),
  }));
}

function collectLiveTranscriptMessageIds(
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

function mergeRefreshedTailWithLiveMessages(
  refreshedMessages: readonly ChatMessageUi[],
  currentMessages: readonly ChatMessageUi[],
  streaming: boolean,
): ChatMessageUi[] {
  const liveIds = collectLiveTranscriptMessageIds(currentMessages, streaming);
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

export function chatUiReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
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
        activeSessionId: null,
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
        sessions: [],
        activeSessionId: null,
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
        subagentStreams: {},
        subagentChildren: {},
      };
    case 'project/clear':
      return {
        ...state,
        activeScope: { kind: 'general' },
        projectPath: null,
        projectTrusted: false,
        trustDialogOpen: false,
        sessions: [],
        activeSessionId: null,
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
        subagentStreams: {},
        subagentChildren: {},
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
      const keepPreviousWhileLoading =
        !warmHit &&
        awaitingTranscript &&
        switchingAway &&
        state.messages.length > 0;

      return {
        ...state,
        activeSessionId: action.sessionId,
        warmSessionCache,
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
        activeRunId: preserveOptimisticDraftSend ? state.activeRunId : null,
        activeRunPhase: preserveOptimisticDraftSend ? state.activeRunPhase : null,
        activeRunPhaseDetail: preserveOptimisticDraftSend ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: preserveOptimisticDraftSend ? state.activeRunStartedAt : null,
        lastTerminalRunId: null,
        streaming: preserveOptimisticDraftSend ? true : false,
        activeSkill: preserveOptimisticDraftSend ? state.activeSkill : null,
        outline: warmHit
          ? warmHit.outline
          : keepPreviousWhileLoading
            ? state.outline
            : [],
        activeSessionArchived: false,
        awaitingTranscript,
        runTerminal: { kind: 'none' },
        // C1: clear event id ring for the new session
        receivedEventIds: [],
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
        subagentStreams: {},
        subagentChildren: {},
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
        runPhase: action.preserveActiveTail ? state.runPhase : 'idle',
        activeRunId: action.preserveActiveTail ? state.activeRunId : null,
        activeRunPhase: action.preserveActiveTail ? state.activeRunPhase : null,
        activeRunPhaseDetail: action.preserveActiveTail ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: action.preserveActiveTail ? state.activeRunStartedAt : null,
        lastTerminalRunId: action.preserveActiveTail ? state.lastTerminalRunId : null,
        streaming: action.preserveActiveTail ? state.streaming : false,
        activeSkill: action.preserveActiveTail ? state.activeSkill : null,
        outline: action.outline ?? [],
        activeSessionArchived: action.preserveActiveTail ? state.activeSessionArchived : false,
        awaitingTranscript: false,
        contextUsage: action.contextUsage !== undefined ? action.contextUsage : state.contextUsage,
        runTerminal: action.preserveActiveTail ? state.runTerminal : { kind: 'none' },
        error: null,
        runRecordsById: action.preserveActiveTail
          ? { ...hydratedRunRecords, ...state.runRecordsById }
          : hydratedRunRecords,
        // Walkthrough artifacts are hydrated separately via walkthrough/list
        // after load. Do NOT clear the map here: session/set (which fires
        // before load-messages) already clears it, and a walkthrough/list
        // response may resolve before load-messages is dispatched — clearing
        // here would wipe the freshly-hydrated map.
        // `live` means the session handle can accept a future prompt. It does
        // not mean that a prompt is currently running, so never add a working
        // marker while restoring transcript history.
        workingSessionIds:
          action.live === false
            ? removeWorkingSessionId(state.workingSessionIds, action.sessionId)
            : { ...state.workingSessionIds },
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
      return {
        ...state,
        historyView: {
          anchorMessageId: action.window.anchorMessageId,
          messages: bounded.messages,
          runRecordsById: buildRunRecordsFromTranscriptMessages(action.messages),
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
      const unboundedSessionsForPath = listable
        ? [newSession, ...state.sessions.filter((item) => item.id !== action.sessionId)]
        : state.sessions.filter((item) => item.id !== action.sessionId);
      const activePageLimit =
        state.activeScope.kind === 'general'
          ? GENERAL_SESSION_WINDOW_MAX_ITEMS
          : PROJECT_SESSION_WINDOW_MAX_ITEMS;
      const nextSessionsForPath = state.sessionListsWindowed
        ? unboundedSessionsForPath.slice(0, activePageLimit)
        : unboundedSessionsForPath;
      const nextGeneralSessions = listable
        ? [newSession, ...state.generalSessions.filter((item) => item.id !== action.sessionId)]
        : state.generalSessions.filter((item) => item.id !== action.sessionId);
      return {
        ...state,
        sessions: nextSessionsForPath,
        generalSessions:
          state.activeScope.kind === 'general' && listable
            ? state.sessionListsWindowed
              ? nextGeneralSessions.slice(0, GENERAL_SESSION_WINDOW_MAX_ITEMS)
              : nextGeneralSessions
            : state.generalSessions.filter((item) => item.id !== action.sessionId),
        // Mirror the new row into the folder tree for the active project.
        projectSessionsByPath:
          projectPath != null && listable
            ? { ...state.projectSessionsByPath, [projectPath]: nextSessionsForPath }
            : state.projectSessionsByPath,
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
    case 'session/hydrate-page': {
      const listable = action.sessions.filter((session) => !isPlaceholderSessionName(session.name));
      if (action.scope.kind === 'general') {
        return {
          ...state,
          sessionListsWindowed: true,
          generalSessions: listable,
          ...(state.activeScope.kind === 'general'
            ? {
                sessions: listable,
                // Page navigation must not deselect the active transcript when
                // the user intentionally moves to another index page.
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
        sessionListsWindowed: true,
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
      const mergedForCheck = {
        ...(state.sessions.find((session) => session.id === action.session.id) ??
          state.generalSessions.find((session) => session.id === action.session.id) ??
          Object.values(state.projectSessionsByPath)
            .flat()
            .find((session) => session.id === action.session.id) ?? {
            id: action.session.id,
            name: '',
          }),
        ...action.session,
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
        pageLimit: number,
      ): SessionListItemUi[] => {
        let next = list.map((session) =>
          session.id === action.session.id ? { ...session, ...action.session } : session,
        );
        if (shouldOwn && listable) {
          if (!next.some((session) => session.id === action.session.id)) {
            const canInsert =
              !state.sessionListsWindowed || state.activeSessionId === action.session.id;
            if (canInsert) {
              next.unshift({
                ...action.session,
                id: action.session.id,
                name: action.session.name ?? mergedForCheck.name,
              });
            }
          }
        } else if (!shouldOwn || !listable) {
          next = next.filter((session) => session.id !== action.session.id);
        }
        const sorted = sortPinnedThenUpdated(next);
        return state.sessionListsWindowed ? sorted.slice(0, pageLimit) : sorted;
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
      const activePageLimit =
        state.activeScope.kind === 'general'
          ? GENERAL_SESSION_WINDOW_MAX_ITEMS
          : PROJECT_SESSION_WINDOW_MAX_ITEMS;
      const nextSessions = upsertIntoList(state.sessions, activeListOwnsSession, activePageLimit);
      const nextGeneral = upsertIntoList(
        state.generalSessions,
        belongsToGeneral,
        GENERAL_SESSION_WINDOW_MAX_ITEMS,
      );

      if (owningProjectPath != null) {
        const owned = state.projectSessionsByPath[owningProjectPath] ?? [];
        const nextOwned = upsertIntoList(owned, true, PROJECT_SESSION_WINDOW_MAX_ITEMS);
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
        };
      }
      return { ...state, sessions: nextSessions, generalSessions: nextGeneral };
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
      const activeRemoved = state.activeSessionId === action.sessionId;
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneralSessions,
        projectSessionsByPath: nextProjectSessionsByPath,
        warmSessionCache: removeWarmSessionSnapshot(state.warmSessionCache, action.sessionId),
        // Do not auto-select another session when the active one is removed.
        activeSessionId: activeRemoved ? null : state.activeSessionId,
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
      };
    case 'session/truncate': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      const messages = mapTranscriptMessagesToUi(action.messages);
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
        runRecordsById: buildRunRecordsFromTranscriptMessages(action.messages),
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
        ...(shouldClearStreaming
          ? {
              runPhase: 'idle' as const,
              streaming: false,
              activeRunPhase: null,
              activeRunPhaseDetail: null,
              activeRunStartedAt: null,
              activeSkill: null,
            }
          : {}),
      };
    }
    case 'run/aborting':
      return {
        ...state,
        runPhase: 'aborting',
        streaming: true,
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
    case 'run/updated':
      if (state.activeSessionId !== action.run.sessionId) return state;
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
      return enforceBoundedTranscriptWindow(applyRunRecord(state, action.run, true));
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
      return { ...state, hostReady: action.ready, hostMock: action.mock };
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
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        activeSkill: null,
        runTerminal: { kind: 'failed', message: action.message, at: Date.now() },
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
    case 'transcript/append': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      if (state.messages.some((item) => item.id === action.message.id)) {
        return state;
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
          action.message.role === 'user' && action.message.text.trim().length > 0
            ? null
            : state.userMessageIndex,
        userMessageIndexEpoch:
          action.message.role === 'user' && action.message.text.trim().length > 0
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
      return applySubagentStreamEvent(state, action.childSessionId, action.event);
    }
    case 'subagent/updated': {
      // Cross-session guard: child lifecycle pushes for a non-active parent
      // must not leak into the visible children map.
      if (state.activeSessionId !== action.parentSessionId) {
        return state;
      }
      const child = action.child;
      const nextChildren = { ...state.subagentChildren, [child.id]: child };
      return { ...state, subagentChildren: nextChildren };
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
      return { ...state, subagentChildren: nextChildren };
    }
    case 'subagent/batch-updated': {
      if (state.activeSessionId !== action.parentSessionId) return state;
      const nextBatches = { ...state.subagentBatches, [action.runId]: action.result };
      return { ...state, subagentBatches: nextBatches };
    }
    case 'subagent/task-updated': {
      if (state.activeSessionId !== action.parentSessionId) return state;
      const key = `${action.runId}:${action.result.taskId}`;
      const nextTaskResults = { ...state.subagentTaskResults, [key]: action.result };
      return { ...state, subagentTaskResults: nextTaskResults };
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

/**
 * Apply a child session AgentEvent to the inline subagent stream state.
 * Accumulates text/thinking deltas and tool lifecycle for live expand UX.
 */
function applySubagentStreamEvent(
  state: ChatUiState,
  childSessionId: string,
  event: AgentEvent,
): ChatUiState {
  const existing = state.subagentStreams[childSessionId] ?? {
    childSessionId,
    text: '',
    thinking: '',
    tools: [],
    streaming: false,
    currentMessageId: null,
  };

  switch (event.type) {
    case 'message/start': {
      if (event.role !== 'assistant') return state;
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        currentMessageId: event.messageId,
        text: '',
        thinking: '',
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/text_delta': {
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        text: existing.text + event.delta,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/text_snapshot': {
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        text: event.text,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/thinking_delta': {
      const updated: SubagentStreamState = {
        ...existing,
        streaming: true,
        thinking: existing.thinking + event.delta,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'message/end': {
      const updated: SubagentStreamState = {
        ...existing,
        streaming: false,
      };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/start': {
      const tools = [...existing.tools];
      const existingIdx = tools.findIndex((t) => t.toolCallId === event.toolCallId);
      const tool: SubagentStreamTool = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        output: '',
        outputRetainedBytes: 0,
        outputTruncated: false,
      };
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
      const tools = existing.tools.map((tool) => {
        if (tool.toolCallId !== event.toolCallId) {
          return tool;
        }
        const output = appendBoundedToolOutput(tool, event.delta);
        return {
          ...tool,
          output: output.text,
          outputRetainedBytes: output.retainedBytes,
          outputTruncated: output.truncated,
        };
      });
      const updated: SubagentStreamState = { ...existing, tools };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'tool/end': {
      const tools = existing.tools.map((t) =>
        t.toolCallId === event.toolCallId
          ? { ...t, status: (event.isError ? 'error' : 'done') as 'done' | 'error' }
          : t,
      );
      const updated: SubagentStreamState = { ...existing, tools };
      return {
        ...state,
        subagentStreams: { ...state.subagentStreams, [childSessionId]: updated },
      };
    }
    case 'session/aborted':
    case 'session/ended': {
      const updated: SubagentStreamState = { ...existing, streaming: false };
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
  if (state.receivedEventIds.includes(envelope.eventId)) {
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
  if (!nextReceivedEventIds.includes(envelope.eventId)) {
    nextReceivedEventIds = [...nextReceivedEventIds, envelope.eventId];
    // Bounded ring: drop oldest when over limit
    if (nextReceivedEventIds.length > MAX_RETAINED_EVENT_IDS) {
      nextReceivedEventIds = nextReceivedEventIds.slice(EVENT_ID_TRIM_BATCH);
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
      const message: ChatMessageUi = {
        id: event.messageId,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'streaming',
        ...(resolvedRunId ? { runId: resolvedRunId } : {}),
      };
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, message],
        runPhase: 'streaming',
        ...(event.runId ? { activeRunId: event.runId, activeRunPhase: 'streaming' as const } : {}),
        streaming: true,
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
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        text: message.text + event.delta,
        status: 'streaming',
      }));
    /** C1: complete text snapshot replaces, not appends. */
    case 'message/text_snapshot':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        text: event.text,
        status: message.status,
      }));
    case 'message/thinking_delta':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      if (!state.messages.some((message) => message.id === event.messageId)) {
        return state;
      }
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        thinking: message.thinking + event.delta,
      }));
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
      const next = updateMessage(state, event.messageId, (message) => ({
        ...message,
        status: 'done',
      }));
      // Pi can emit assistant lifecycle entries that contain no reasoning,
      // tool activity, or text. They are transport bookkeeping, not a user
      // visible answer; retaining them creates the repeated empty `piwin` rows.
      const completedMessage = next.messages.find((message) => message.id === event.messageId);
      if (
        completedMessage?.role === 'assistant' &&
        completedMessage.text.trim().length === 0 &&
        completedMessage.thinking.trim().length === 0 &&
        completedMessage.tools.length === 0 &&
        (completedMessage.searchEvidence?.citations.length ?? 0) === 0
      ) {
        next.messages = next.messages.filter((message) => message.id !== event.messageId);
      }
      const hasRunningTool = next.messages.some((message) =>
        message.tools.some((tool) => tool.status === 'running'),
      );
      if (event.runId !== undefined) {
        return enforceBoundedTranscriptWindow({
          ...next,
          activeRunPhase: hasRunningTool ? 'tool-running' : 'streaming',
          runPhase: 'streaming',
          streaming: true,
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
        completedAttentionSessionIds:
          hasRunningTool || state.activeSessionId === null
            ? state.completedAttentionSessionIds
            : {
                ...state.completedAttentionSessionIds,
                [state.activeSessionId]: true,
              },
      });
    }
    case 'session/aborted': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const messageId = event.messageId;
      const nextMessages = messageId
        ? state.messages.map((message) =>
            message.id === messageId ? { ...message, status: 'done' as const } : message,
          )
        : state.messages.map((message) =>
            message.status === 'streaming' ? { ...message, status: 'done' as const } : message,
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
      const ownerMessage = findAssistantMessageForToolStart(state, event.runId);
      if (!ownerMessage) {
        return state;
      }
      return updateMessage(state, ownerMessage.id, (message) => {
        const output = createBoundedToolOutput(event.presentation?.output?.text ?? '');
        return {
          ...message,
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
            },
          ],
        };
      });
    }
    case 'tool/update':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      return updateOwnedTool(state, event.toolCallId, event.runId, (tool) => {
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
        };
      });
    case 'tool/end':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      {
        const updatedState = updateOwnedTool(state, event.toolCallId, event.runId, (tool) => {
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
            ...(mergedPresentation
              ? { presentation: projectBoundedToolPresentation(mergedPresentation, output) }
              : {}),
          };
        });
        if (!event.attachments || event.attachments.length === 0) {
          return updatedState;
        }
        return appendGeneratedAttachmentsToToolOwner(
          updatedState,
          event.toolCallId,
          event.runId,
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
    case 'error':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      {
        const failedMessages = state.messages.map((message) => ({
          ...message,
          status: message.status === 'streaming' ? ('error' as const) : message.status,
          tools: message.tools.map((tool) => ({
            ...tool,
            status: tool.status === 'running' ? ('error' as const) : tool.status,
          })),
        }));
        return {
          ...state,
          messages: failedMessages,
          error: event.message,
          runPhase: 'idle',
          streaming: false,
          compacting: false,
          activeSkill: null,
          runTerminal: { kind: 'failed', message: event.message, at: Date.now() },
        };
      }
    default:
      return state;
  }
}

function isStaleRunEvent(state: ChatUiState, runId: string): boolean {
  return (
    (state.activeRunId !== null && state.activeRunId !== runId) ||
    (state.activeRunId === null && state.lastTerminalRunId === runId)
  );
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
    return {
      ...state,
      activeRunId: run.runId,
      activeRunPhase: run.phase ?? state.activeRunPhase,
      activeRunPhaseDetail: run.phaseDetail ?? null,
      activeRunStartedAt: run.startedAt ? parseEventTime(run.startedAt) : state.activeRunStartedAt,
      runPhase: run.status === 'cancelling' ? 'aborting' : 'streaming',
      streaming: true,
      lastTerminalRunId: null,
      runTerminal: { kind: 'none' },
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
  return {
    ...state,
    activeRunId: null,
    activeRunPhase: null,
    activeRunPhaseDetail: null,
    activeRunStartedAt: null,
    lastTerminalRunId: run.runId,
    runPhase: 'idle',
    streaming: false,
    activeSkill: null,
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
    // delivery forms have identical completion behavior.
    completedAttentionSessionIds:
      outcome === 'completed' || outcome === 'failed'
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

/**
 * Prefer the assistant message that owns this run; fall back only for legacy
 * events without runId to the latest assistant bubble still streaming/open.
 */
function findAssistantMessageForToolStart(
  state: ChatUiState,
  runId: string | undefined,
): ChatMessageUi | undefined {
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
  updater: (tool: ToolCardUi) => ToolCardUi,
): ChatUiState {
  let matched = false;
  const nextMessages = state.messages.map((message) => {
    if (matched) {
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
  attachments: readonly MediaAttachmentRef[],
): ChatUiState {
  let matched = false;
  const nextMessages = state.messages.map((message) => {
    if (matched) {
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
