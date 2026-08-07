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
  SessionSummary,
  SessionTranscriptMessage,
  SubagentActivityView,
  SubagentBatchProjection,
  SubagentTaskResult,
  ToolPresentation,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { SessionOutlineNode } from '@piwin/contracts';

const MAX_RETAINED_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';

/** C1: maximum event ids retained for replay detection per session. */
const MAX_RETAINED_EVENT_IDS = 10_000;
/** C1: when the event id ring exceeds the max, drop this many oldest entries. */
const EVENT_ID_TRIM_BATCH = 5_000;

export type ToolCardUi = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
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
  createdAt?: string;
  /** Run that produced this assistant message when host provided run identity. */
  runId?: string;
  subagentActivity?: SubagentActivityView;
};

/** Inline subagent stream state — live child session work shown in parent UI. */
export type SubagentStreamTool = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
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
};

export type RunTerminalState =
  | { kind: 'none' }
  | { kind: 'stopped'; at: number }
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
  activeSessionId: string | null;
  messages: ChatMessageUi[];
  outline: SessionOutlineNode[];
  /** Active session was archived without switching context. */
  activeSessionArchived: boolean;
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
};

export type ChatUiAction =
  | { type: 'scope/set'; scope: SessionScope }
  | { type: 'project/set'; path: string; trusted: boolean }
  | { type: 'project/clear' }
  | { type: 'project/trust-dialog'; open: boolean }
  | { type: 'project/trusted' }
  | { type: 'session/set'; sessionId: string }
  | { type: 'session/add'; sessionId: string; name: string }
  | { type: 'session/hydrate'; sessions: SessionListItemUi[] }
  | { type: 'session/hydrate-general'; sessions: SessionListItemUi[] }
  | {
      type: 'session/hydrate-project';
      projectPath: string;
      sessions: SessionListItemUi[];
    }
  | {
      type: 'session/load-messages';
      sessionId: string;
      messages: SessionTranscriptMessage[];
      outline?: SessionOutlineNode[];
      /** Whether the host has a live handle; this is not a run-status signal. */
      live?: boolean;
    }
  | { type: 'session/update'; session: SessionListItemUi }
  | { type: 'session/remove'; sessionId: string }
  | { type: 'session/mark-archived-active'; archived: boolean }
  | { type: 'session/hide-from-list'; sessionId: string }
  | { type: 'session/clear-active' }
  | { type: 'session/truncate'; sessionId: string; messages: SessionTranscriptMessage[] }
  | {
      type: 'user/send';
      text: string;
      attachments?: PromptAttachment[];
      /** Client-generated id so failed sends can roll back the optimistic bubble. */
      clientMessageId?: string;
    }
  | { type: 'user/send-rollback'; clientMessageId: string }
  | { type: 'run/aborting' }
  | { type: 'run/accepted'; runId: string; acceptedAt?: string }
  | { type: 'run/updated'; run: ExecutionRunRecord }
  | { type: 'run/terminal'; run: ExecutionRunRecord }
  | { type: 'run/terminal-dismiss' }
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
    activeSessionId: null,
    messages: [],
    outline: [],
    activeSessionArchived: false,
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
    text: message.text,
    thinking: message.thinking ?? '',
    tools: (message.tools ?? []).map((tool) => ({
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      status: tool.status,
      output: tool.output,
      ...(tool.runId ? { runId: tool.runId } : {}),
      ...(tool.presentation ? { presentation: tool.presentation } : {}),
    })),
    attachments: message.attachments ?? [],
    status:
      options.keepStreamingStatus === true
        ? message.status
        : message.status === 'streaming'
          ? 'done'
          : message.status,
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.subagentActivity ? { subagentActivity: message.subagentActivity } : {}),
  }));
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
        outline: [],
        activeSessionArchived: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
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
        outline: [],
        activeSessionArchived: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
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
        outline: [],
        activeSessionArchived: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
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
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: preserveOptimisticDraftSend ? state.messages : [],
        runPhase: preserveOptimisticDraftSend ? state.runPhase : 'idle',
        activeRunId: preserveOptimisticDraftSend ? state.activeRunId : null,
        activeRunPhase: preserveOptimisticDraftSend ? state.activeRunPhase : null,
        activeRunPhaseDetail: preserveOptimisticDraftSend ? state.activeRunPhaseDetail : null,
        activeRunStartedAt: preserveOptimisticDraftSend ? state.activeRunStartedAt : null,
        lastTerminalRunId: null,
        streaming: preserveOptimisticDraftSend ? true : false,
        outline: [],
        activeSessionArchived: false,
        runTerminal: { kind: 'none' },
        // C1: clear event id ring for the new session
        receivedEventIds: [],
        lastAcceptedSequenceByRun: {},
        runRecordsById: {},
        walkthroughsByMessageId: {},
        // Subagent activity belongs to the previously active parent; the new
        // session hydrates its own children on resume.
        subagentStreams: {},
        subagentChildren: {},
        workingSessionIds: preserveOptimisticDraftSend
          ? { ...state.workingSessionIds, [action.sessionId]: true }
          : state.workingSessionIds,
      };
    }
    case 'session/load-messages': {
      const messages: ChatMessageUi[] = mapTranscriptMessagesToUi(action.messages);
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        outline: action.outline ?? [],
        activeSessionArchived: false,
        runTerminal: { kind: 'none' },
        error: null,
        runRecordsById: buildRunRecordsFromTranscriptMessages(action.messages),
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
    case 'session/add': {
      // Stamp updatedAt so Conversations / project lists sort the new row to the
      // top (sort is pinned first, then updatedAt desc; missing timestamps sink).
      const createdAt = new Date().toISOString();
      const newSession: SessionListItemUi = {
        id: action.sessionId,
        name: action.name,
        updatedAt: createdAt,
      };
      // Sidebar policy: placeholder / empty names never enter the list. The
      // session can still be active (composer) until the first text title lands.
      const listable = !isPlaceholderSessionName(action.name);
      const projectPath =
        state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
      const nextSessionsForPath = listable
        ? [newSession, ...state.sessions.filter((item) => item.id !== action.sessionId)]
        : state.sessions.filter((item) => item.id !== action.sessionId);
      return {
        ...state,
        sessions: nextSessionsForPath,
        generalSessions:
          state.activeScope.kind === 'general' && listable
            ? [newSession, ...state.generalSessions.filter((item) => item.id !== action.sessionId)]
            : state.generalSessions.filter((item) => item.id !== action.sessionId),
        // Mirror the new row into the folder tree for the active project.
        projectSessionsByPath:
          projectPath != null && listable
            ? { ...state.projectSessionsByPath, [projectPath]: nextSessionsForPath }
            : state.projectSessionsByPath,
        activeSessionId: action.sessionId,
        messages: [],
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
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
      const nextSessions = state.sessions.map((session) =>
        session.id === action.session.id ? { ...session, ...action.session } : session,
      );
      const mergedForCheck = {
        ...(state.sessions.find((session) => session.id === action.session.id) ??
          state.generalSessions.find((session) => session.id === action.session.id) ?? {
            id: action.session.id,
            name: '',
          }),
        ...action.session,
      };
      const listable = !isPlaceholderSessionName(mergedForCheck.name);
      if (listable) {
        if (!nextSessions.some((session) => session.id === action.session.id)) {
          nextSessions.unshift({
            ...action.session,
            id: action.session.id,
            name: action.session.name ?? mergedForCheck.name,
          });
        }
      } else {
        // Drop unlisted placeholders if a bad name ever lands.
        const dropIdx = nextSessions.findIndex((session) => session.id === action.session.id);
        if (dropIdx >= 0) {
          nextSessions.splice(dropIdx, 1);
        }
      }
      sortPinnedThenUpdated(nextSessions);
      // Mirror into generalSessions (insert on first real name for general scope).
      let nextGeneral = state.generalSessions.map((session) =>
        session.id === action.session.id ? { ...session, ...action.session } : session,
      );
      if (listable) {
        if (!nextGeneral.some((session) => session.id === action.session.id)) {
          // Prefer general list when active scope is general OR session already general-tracked.
          if (
            state.activeScope.kind === 'general' ||
            state.generalSessions.some((session) => session.id === action.session.id)
          ) {
            nextGeneral.unshift({
              ...action.session,
              id: action.session.id,
              name: action.session.name ?? mergedForCheck.name,
            });
          }
        }
      } else {
        nextGeneral = nextGeneral.filter((session) => session.id !== action.session.id);
      }
      sortPinnedThenUpdated(nextGeneral);
      // Mirror the update into the owning project folder in the sidebar tree.
      // The session's own scope is authoritative; fall back to the active
      // project for UI-generated interim updates that lack a scope.
      const ownProjectPath =
        action.session.scope?.kind === 'project' ? action.session.scope.projectPath : undefined;
      const owningProjectPath =
        ownProjectPath ??
        Object.entries(state.projectSessionsByPath).find(([, list]) =>
          list.some((session) => session.id === action.session.id),
        )?.[0] ??
        (state.activeScope.kind === 'project' ? state.activeScope.projectPath : null);
      if (owningProjectPath != null) {
        const owned = state.projectSessionsByPath[owningProjectPath] ?? [];
        const nextOwned = owned.map((session) =>
          session.id === action.session.id ? { ...session, ...action.session } : session,
        );
        if (listable) {
          if (!nextOwned.some((session) => session.id === action.session.id)) {
            nextOwned.unshift({
              ...action.session,
              id: action.session.id,
              name: action.session.name ?? mergedForCheck.name,
            });
          }
        } else {
          const dropIdx = nextOwned.findIndex((session) => session.id === action.session.id);
          if (dropIdx >= 0) {
            nextOwned.splice(dropIdx, 1);
          }
        }
        sortPinnedThenUpdated(nextOwned);
        return {
          ...state,
          sessions: nextSessions,
          generalSessions: nextGeneral,
          projectSessionsByPath: {
            ...state.projectSessionsByPath,
            [owningProjectPath]: nextOwned,
          },
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
        // Do not auto-select another session when the active one is removed.
        activeSessionId: activeRemoved ? null : state.activeSessionId,
        messages: activeRemoved ? [] : state.messages,
        outline: activeRemoved ? [] : state.outline,
        activeSessionArchived: activeRemoved ? false : state.activeSessionArchived,
        runPhase: activeRemoved ? 'idle' : state.runPhase,
        activeRunId: activeRemoved ? null : state.activeRunId,
        activeRunPhase: activeRemoved ? null : state.activeRunPhase,
        activeRunStartedAt: activeRemoved ? null : state.activeRunStartedAt,
        streaming: activeRemoved ? false : state.streaming,
        runTerminal: activeRemoved ? { kind: 'none' } : state.runTerminal,
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
        outline: [],
        activeSessionArchived: false,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: { kind: 'none' },
        walkthroughsByMessageId: {},
      };
    case 'session/truncate': {
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      const messages: ChatMessageUi[] = action.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        thinking: message.thinking ?? '',
        tools: (message.tools ?? []).map((tool) => ({
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          status: tool.status,
          output: tool.output,
        })),
        attachments: message.attachments ?? [],
        status: message.status === 'streaming' ? 'done' : message.status,
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      }));
      return {
        ...state,
        messages,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        error: null,
      };
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
      return {
        ...state,
        messages: [...state.messages, userMessage],
        runPhase: 'streaming',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        streaming: true,
        runTerminal: { kind: 'none' },
        error: null,
        workingSessionIds: state.activeSessionId
          ? { ...state.workingSessionIds, [state.activeSessionId]: true }
          : state.workingSessionIds,
      };
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
      return applyRunRecord(state, action.run);
    case 'run/terminal':
      if (state.activeSessionId !== action.run.sessionId) {
        // Terminal pushes are global. A run can finish after the user has
        // switched sessions, so still clear its background working marker.
        return action.run.kind === 'session-turn'
          ? {
              ...state,
              workingSessionIds: removeWorkingSessionId(
                state.workingSessionIds,
                action.run.sessionId,
              ),
            }
          : state;
      }
      return applyRunRecord(state, action.run);
    case 'run/terminal-dismiss':
      return {
        ...state,
        runTerminal: { kind: 'none' },
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
      return {
        ...state,
        messages: [...state.messages, nextMessage],
      };
    }
    case 'event':
      if (state.activeSessionId !== action.sessionId) {
        return state;
      }
      if (isStaleByEnvelope(state, action)) {
        return state;
      }
      return applyAgentEvent(recordEventEnvelope(state, action), action.event);
    case 'event/batch': {
      if (state.activeSessionId !== action.sessionId) {
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
      const tools = existing.tools.map((t) =>
        t.toolCallId === event.toolCallId ? { ...t, output: t.output + event.delta } : t,
      );
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

/** Remove a session ID from the working set, returning a new record. */
function removeWorkingSessionId(
  working: Record<string, true>,
  sessionId: string | null,
): Record<string, true> {
  if (!sessionId || !(sessionId in working)) {
    return working;
  }
  const next = { ...working };
  delete next[sessionId];
  return next;
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
      return {
        ...state,
        messages: [...state.messages, message],
        runPhase: 'streaming',
        ...(event.runId ? { activeRunId: event.runId, activeRunPhase: 'streaming' as const } : {}),
        streaming: true,
        runTerminal: { kind: 'none' },
      };
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
        completedMessage.tools.length === 0
      ) {
        next.messages = next.messages.filter((message) => message.id !== event.messageId);
      }
      const hasRunningTool = next.messages.some((message) =>
        message.tools.some((tool) => tool.status === 'running'),
      );
      if (event.runId !== undefined) {
        return {
          ...next,
          activeRunPhase: hasRunningTool ? 'tool-running' : 'streaming',
          runPhase: 'streaming',
          streaming: true,
        };
      }
      return {
        ...next,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: null,
        streaming: false,
        runTerminal: hasRunningTool ? next.runTerminal : { kind: 'complete', at: Date.now() },
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      };
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
      return {
        ...state,
        messages: nextMessages,
        runPhase: 'idle',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        lastTerminalRunId: event.runId ?? null,
        streaming: false,
        runTerminal: { kind: 'stopped', at: Date.now() },
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      };
    }
    case 'tool/start': {
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      const ownerMessage = findAssistantMessageForToolStart(state, event.runId);
      if (!ownerMessage) {
        return state;
      }
      return updateMessage(state, ownerMessage.id, (message) => ({
        ...message,
        tools: [
          ...message.tools,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            output: '',
            ...(event.presentation ? { presentation: event.presentation } : {}),
            ...(event.runId ? { runId: event.runId } : {}),
          },
        ],
      }));
    }
    case 'tool/update':
      if (isStaleOptionalRunEvent(state, event.runId)) {
        return state;
      }
      return updateOwnedTool(state, event.toolCallId, event.runId, (tool) => ({
        ...tool,
        output:
          event.presentation?.output?.text ??
          appendBoundedToolOutput(tool.output, redactDisplayText(event.delta)),
        ...(event.presentation
          ? { presentation: mergeToolPresentation(tool.presentation, event.presentation) }
          : {}),
      }));
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
          return {
            ...tool,
            status: event.isError ? 'error' : 'done',
            output: displayOutput,
            ...(mergedPresentation ? { presentation: mergedPresentation } : {}),
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
      return {
        ...state,
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
function applyRunRecord(state: ChatUiState, run: ExecutionRunRecord): ChatUiState {
  const previousRecord = state.runRecordsById[run.runId];
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
      : run.status === 'cancelled' || run.status === 'interrupted'
        ? ('cancelled' as const)
        : run.status === 'failed'
          ? ('failed' as const)
          : undefined;
  const nextRecord: RunRecordUi = {
    runId: run.runId,
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
    error: outcome === 'failed' ? (run.error ?? 'Run failed') : state.error,
    runTerminal:
      outcome === 'cancelled'
        ? { kind: 'stopped', at: Date.now() }
        : outcome === 'failed'
          ? { kind: 'failed', message: run.error ?? 'Run failed', at: Date.now() }
          : { kind: 'complete', at: Date.now() },
    runRecordsById: records,
    workingSessionIds: removeWorkingSessionId(state.workingSessionIds, run.sessionId),
  };
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

function appendBoundedToolOutput(existingOutput: string, nextDelta: string): string {
  if (existingOutput.endsWith(TOOL_OUTPUT_TRUNCATION_MARKER)) {
    return existingOutput;
  }

  const combinedOutput = existingOutput + nextDelta;
  if (getUtf8ByteLength(combinedOutput) <= MAX_RETAINED_TOOL_OUTPUT_BYTES) {
    return combinedOutput;
  }

  const markerBytes = getUtf8ByteLength(TOOL_OUTPUT_TRUNCATION_MARKER);
  const retainedPrefixBytes = Math.max(0, MAX_RETAINED_TOOL_OUTPUT_BYTES - markerBytes);
  const retainedPrefix = truncateUtf8(combinedOutput, retainedPrefixBytes);
  return `${retainedPrefix}${TOOL_OUTPUT_TRUNCATION_MARKER}`;
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let retainedBytes = 0;
  let retainedText = '';
  for (const character of value) {
    const characterBytes = getUtf8ByteLength(character);
    if (retainedBytes + characterBytes > maximumBytes) {
      break;
    }
    retainedText += character;
    retainedBytes += characterBytes;
  }
  return retainedText;
}
