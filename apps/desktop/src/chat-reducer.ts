import type {
  AgentEvent,
  AgentEventEnvelope,
  ContextUsageSnapshot,
  PromptAttachment,
  PermissionDecision,
  PermissionRequestContext,
  SessionRunOutcome,
  SessionRunPhase,
  SessionScope,
  SessionSummary,
  SessionTranscriptMessage,
  SubagentActivityView,
  SubagentBatchResult,
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
  subagentBatches: Record<string, SubagentBatchResult>;
  /** CE-SUB-ORCH: latest per-task results keyed by `${runId}:${taskId}`. */
  subagentTaskResults: Record<string, SubagentTaskResult>;
  /**
   * Walkthrough artifacts keyed by owning assistant messageId (spec §5.1).
   * Cleared on session switch so stale artifacts never leak across sessions.
   */
  walkthroughsByMessageId: Record<string, WalkthroughArtifact>;
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
      type: 'session/load-messages';
      sessionId: string;
      messages: SessionTranscriptMessage[];
      outline?: SessionOutlineNode[];
    }
  | { type: 'session/update'; session: SessionListItemUi }
  | { type: 'session/remove'; sessionId: string }
  | { type: 'session/mark-archived-active'; archived: boolean }
  | { type: 'session/hide-from-list'; sessionId: string }
  | { type: 'session/clear-active' }
  | { type: 'session/truncate'; sessionId: string; messages: SessionTranscriptMessage[] }
  | { type: 'user/send'; text: string; attachments?: PromptAttachment[] }
  | { type: 'run/aborting' }
  | { type: 'run/accepted'; runId: string; acceptedAt?: string }
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
      type: 'subagent/batch-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentBatchResult;
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
      };
    case 'project/trust-dialog':
      return { ...state, trustDialogOpen: action.open };
    case 'project/trusted':
      return { ...state, projectTrusted: true, trustDialogOpen: false };
    case 'session/set':
      return {
        ...state,
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
        // C1: clear event id ring for the new session
        receivedEventIds: [],
        lastAcceptedSequenceByRun: {},
        runRecordsById: {},
        walkthroughsByMessageId: {},
      };
    case 'session/load-messages': {
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
          ...(tool.runId ? { runId: tool.runId } : {}),
          ...(tool.presentation ? { presentation: tool.presentation } : {}),
        })),
        attachments: message.attachments ?? [],
        status: message.status === 'streaming' ? 'done' : message.status,
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
        ...(message.runId ? { runId: message.runId } : {}),
        ...(message.subagentActivity ? { subagentActivity: message.subagentActivity } : {}),
      }));
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
      };
    }
    case 'session/add':
      return {
        ...state,
        sessions: [
          { id: action.sessionId, name: action.name },
          ...state.sessions.filter((item) => item.id !== action.sessionId),
        ],
        // If the new session is general-scope (inferred from activeScope), also
        // prepend it to generalSessions so the Conversations section stays current.
        generalSessions:
          state.activeScope.kind === 'general'
            ? [
                { id: action.sessionId, name: action.name },
                ...state.generalSessions.filter((item) => item.id !== action.sessionId),
              ]
            : state.generalSessions,
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
    case 'session/hydrate':
      return {
        ...state,
        sessions: action.sessions,
        // Keep generalSessions in sync when general is the active scope.
        generalSessions:
          state.activeScope.kind === 'general' ? action.sessions : state.generalSessions,
        activeSessionId: action.sessions.some((session) => session.id === state.activeSessionId)
          ? state.activeSessionId
          : null,
      };
    case 'session/hydrate-general':
      return {
        ...state,
        generalSessions: action.sessions,
        // If general is the active scope, also mirror into sessions so the
        // active session list and activeSessionId stay in sync. The reducer
        // always sees up-to-date state (actions processed in order), even
        // when the dispatching closure had stale activeScope.
        ...(state.activeScope.kind === 'general'
          ? {
              sessions: action.sessions,
              activeSessionId: action.sessions.some(
                (session) => session.id === state.activeSessionId,
              )
                ? state.activeSessionId
                : null,
            }
          : {}),
      };
    case 'session/update': {
      const sortPinnedThenUpdated = (list: SessionListItemUi[]): SessionListItemUi[] => {
        list.sort((left, right) => {
          const leftPinned = left.isPinned === true;
          const rightPinned = right.isPinned === true;
          if (leftPinned !== rightPinned) {
            return leftPinned ? -1 : 1;
          }
          const leftTime = left.updatedAt ?? '';
          const rightTime = right.updatedAt ?? '';
          return rightTime.localeCompare(leftTime);
        });
        return list;
      };
      const nextSessions = state.sessions.map((session) =>
        session.id === action.session.id ? { ...session, ...action.session } : session,
      );
      if (!nextSessions.some((session) => session.id === action.session.id)) {
        nextSessions.unshift(action.session);
      }
      sortPinnedThenUpdated(nextSessions);
      // Mirror the update into generalSessions if the session is present there.
      const nextGeneral = state.generalSessions.some((session) => session.id === action.session.id)
        ? (() => {
            const list = state.generalSessions.map((session) =>
              session.id === action.session.id ? { ...session, ...action.session } : session,
            );
            return sortPinnedThenUpdated(list);
          })()
        : state.generalSessions;
      return { ...state, sessions: nextSessions, generalSessions: nextGeneral };
    }
    case 'session/remove': {
      const nextSessions = state.sessions.filter((session) => session.id !== action.sessionId);
      const nextGeneralSessions = state.generalSessions.filter(
        (session) => session.id !== action.sessionId,
      );
      const activeRemoved = state.activeSessionId === action.sessionId;
      return {
        ...state,
        sessions: nextSessions,
        generalSessions: nextGeneralSessions,
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
        id: crypto.randomUUID(),
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
      const nextMessage: ChatMessageUi = {
        id: action.message.id,
        role: action.message.role,
        text: action.message.text,
        thinking: action.message.thinking ?? '',
        tools: (action.message.tools ?? []).map((tool) => ({
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          status: tool.status,
          output: tool.output,
          ...(tool.runId ? { runId: tool.runId } : {}),
          ...(tool.presentation ? { presentation: tool.presentation } : {}),
        })),
        attachments: action.message.attachments ?? [],
        status: action.message.status,
        ...(action.message.runId ? { runId: action.message.runId } : {}),
        ...(action.message.subagentActivity
          ? { subagentActivity: action.message.subagentActivity }
          : {}),
      };
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
      const child = action.child;
      const nextChildren = { ...state.subagentChildren, [child.id]: child };
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
      return updateOwnedTool(state, event.toolCallId, event.runId, (tool) => {
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
    case 'run/phase':
      if (isStaleRunEvent(state, event.runId)) {
        return state;
      }
      {
        const phaseAt = parseEventTime(event.at);
        const previousRecord = state.runRecordsById[event.runId];
        const nextPhaseEntry: RunRecordUi['phaseHistory'][number] = {
          phase: event.phase,
          at: phaseAt,
          ...(event.detail ? { detail: event.detail } : {}),
        };
        const nextRunRecord: RunRecordUi = {
          runId: event.runId,
          phaseHistory: [...(previousRecord?.phaseHistory ?? []), nextPhaseEntry],
          startedAt:
            previousRecord?.startedAt ??
            (state.activeRunId === event.runId && state.activeRunStartedAt !== null
              ? state.activeRunStartedAt
              : phaseAt),
          endedAt: previousRecord?.endedAt ?? null,
          ...(previousRecord?.outcome ? { outcome: previousRecord.outcome } : {}),
          ...(previousRecord?.terminalMessage
            ? { terminalMessage: previousRecord.terminalMessage }
            : {}),
        };
        if (event.phase === 'cancelling') {
          return {
            ...state,
            activeRunId: event.runId,
            activeRunPhase: event.phase,
            activeRunPhaseDetail: event.detail ?? null,
            runPhase: 'aborting',
            streaming: true,
            runRecordsById: {
              ...state.runRecordsById,
              [event.runId]: nextRunRecord,
            },
          };
        }
        return {
          ...state,
          runPhase: 'streaming',
          activeRunId: event.runId,
          activeRunPhase: event.phase,
          activeRunPhaseDetail: event.detail ?? null,
          activeRunStartedAt:
            state.activeRunId === event.runId && state.activeRunStartedAt !== null
              ? state.activeRunStartedAt
              : parseEventTime(event.at),
          lastTerminalRunId: null,
          streaming: true,
          runTerminal: { kind: 'none' },
          runRecordsById: {
            ...state.runRecordsById,
            [event.runId]: {
              ...nextRunRecord,
              startedAt:
                state.activeRunId === event.runId && state.activeRunStartedAt !== null
                  ? state.activeRunStartedAt
                  : nextRunRecord.startedAt,
            },
          },
        };
      }
    case 'run/terminal':
      // Historical / late terminals must never clear a different active run.
      if (state.activeRunId !== null && state.activeRunId !== event.runId) {
        const previousRecord = state.runRecordsById[event.runId];
        if (previousRecord?.outcome) {
          // Already terminal — ignore replay for global and record state.
          return state;
        }
        const endedAt = parseEventTime(event.at);
        return {
          ...state,
          runRecordsById: {
            ...state.runRecordsById,
            [event.runId]: {
              runId: event.runId,
              phaseHistory: previousRecord?.phaseHistory ?? [],
              startedAt: previousRecord?.startedAt ?? null,
              endedAt,
              outcome: event.outcome,
              ...(event.message ? { terminalMessage: event.message } : {}),
            },
          },
        };
      }
      if (
        state.activeRunId === null &&
        state.lastTerminalRunId !== null &&
        state.lastTerminalRunId !== event.runId
      ) {
        // A terminal from any run other than the most recently settled run is
        // historical. Keep its record for inspection, but never replace the
        // global terminal indicator or reopen a settled transcript.
        const previousRecord = state.runRecordsById[event.runId];
        if (previousRecord?.outcome) {
          return state;
        }
        return {
          ...state,
          runRecordsById: {
            ...state.runRecordsById,
            [event.runId]: {
              runId: event.runId,
              phaseHistory: previousRecord?.phaseHistory ?? [],
              startedAt: previousRecord?.startedAt ?? null,
              endedAt: parseEventTime(event.at),
              outcome: event.outcome,
              ...(event.message ? { terminalMessage: event.message } : {}),
            },
          },
        };
      }
      if (state.activeRunId === null && state.lastTerminalRunId === event.runId) {
        // Duplicate terminal for the already-settled active run.
        return state;
      }
      {
        const endedAt = parseEventTime(event.at);
        const previousRecord = state.runRecordsById[event.runId];
        const terminalRecord: RunRecordUi = {
          runId: event.runId,
          phaseHistory: previousRecord?.phaseHistory ?? [],
          startedAt: previousRecord?.startedAt ?? state.activeRunStartedAt,
          endedAt,
          outcome: event.outcome,
          ...(event.message ? { terminalMessage: event.message } : {}),
        };
        const withRecord = {
          ...state,
          runRecordsById: {
            ...state.runRecordsById,
            [event.runId]: terminalRecord,
          },
        };
        if (event.outcome === 'cancelled') {
          return {
            ...withRecord,
            activeRunId: null,
            activeRunPhase: null,
            activeRunPhaseDetail: null,
            activeRunStartedAt: null,
            lastTerminalRunId: event.runId,
            runPhase: 'idle',
            streaming: false,
            runTerminal: { kind: 'stopped', at: Date.now() },
          };
        }
        if (event.outcome === 'failed') {
          return {
            ...withRecord,
            activeRunId: null,
            activeRunPhase: null,
            activeRunPhaseDetail: null,
            activeRunStartedAt: null,
            lastTerminalRunId: event.runId,
            error: event.message ?? 'Run failed',
            runPhase: 'idle',
            streaming: false,
            runTerminal: {
              kind: 'failed',
              message: event.message ?? 'Run failed',
              at: Date.now(),
            },
          };
        }
        return {
          ...withRecord,
          activeRunId: null,
          activeRunPhase: null,
          activeRunPhaseDetail: null,
          activeRunStartedAt: null,
          lastTerminalRunId: event.runId,
          runPhase: 'idle',
          streaming: false,
          runTerminal: { kind: 'complete', at: Date.now() },
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
