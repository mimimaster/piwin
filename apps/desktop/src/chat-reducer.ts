import type { AgentEvent, ContextUsageSnapshot, MediaAttachmentRef, PermissionDecision, SessionTranscriptMessage } from '@piwin/contracts';

export type ToolCardUi = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
};

export type ChatMessageUi = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  thinking: string;
  tools: ToolCardUi[];
  attachments: MediaAttachmentRef[];
  status: 'streaming' | 'done' | 'error';
};

export type PermissionPromptUi = {
  requestId: string;
  sessionId: string;
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
};

export type SessionListItemUi = {
  id: string;
  name: string;
  lastPreview?: string;
  messageCount?: number;
  updatedAt?: string;
  isPinned?: boolean;
  pinnedAt?: string;
};

export type ChatUiState = {
  projectPath: string | null;
  projectTrusted: boolean;
  trustDialogOpen: boolean;
  sessions: SessionListItemUi[];
  activeSessionId: string | null;
  messages: ChatMessageUi[];
  streaming: boolean;
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
  /** CE-OBS last context/token usage for active session. */
  contextUsage: ContextUsageSnapshot | null;
};

export type ChatUiAction =
  | { type: 'project/set'; path: string; trusted: boolean }
  | { type: 'project/trust-dialog'; open: boolean }
  | { type: 'project/trusted' }
  | { type: 'session/set'; sessionId: string }
  | { type: 'session/add'; sessionId: string; name: string }
  | { type: 'session/hydrate'; sessions: SessionListItemUi[] }
  | { type: 'session/load-messages'; sessionId: string; messages: SessionTranscriptMessage[] }
  | { type: 'session/update'; session: SessionListItemUi }
  | { type: 'session/truncate'; sessionId: string; messages: SessionTranscriptMessage[] }
  | { type: 'user/send'; text: string; attachments?: MediaAttachmentRef[] }
  | { type: 'host/status'; ready: boolean; mock: boolean }
  | { type: 'permission/show'; prompt: PermissionPromptUi }
  | { type: 'permission/clear' }
  | { type: 'event'; event: AgentEvent }
  | { type: 'compaction/dismiss' }
  | { type: 'error'; message: string };

export function createInitialChatUiState(): ChatUiState {
  return {
    projectPath: null,
    projectTrusted: false,
    trustDialogOpen: false,
    sessions: [],
    activeSessionId: null,
    messages: [],
    streaming: false,
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
    contextUsage: null,
  };
}

export function chatUiReducer(state: ChatUiState, action: ChatUiAction): ChatUiState {
  switch (action.type) {
    case 'project/set':
      return {
        ...state,
        projectPath: action.path,
        projectTrusted: action.trusted,
        trustDialogOpen: !action.trusted,
        // A project owns its own history. Do not leave another project's rows or
        // transcript visible while the new project's session index is loading.
        sessions: [],
        activeSessionId: null,
        messages: [],
        streaming: false,
        error: null,
      };
    case 'project/trust-dialog':
      return { ...state, trustDialogOpen: action.open };
    case 'project/trusted':
      return { ...state, projectTrusted: true, trustDialogOpen: false };
    case 'session/set':
      return { ...state, activeSessionId: action.sessionId, messages: [], streaming: false };
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
        })),
        attachments: message.attachments ?? [],
        status: message.status === 'streaming' ? 'done' : message.status,
      }));
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages,
        streaming: false,
        error: null,
      };
    }
    case 'session/add':
      return {
        ...state,
        sessions: [
          { id: action.sessionId, name: action.name },
          ...state.sessions.filter((item) => item.id !== action.sessionId),
        ],
        activeSessionId: action.sessionId,
        messages: [],
        streaming: false,
      };
    case 'session/hydrate':
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: action.sessions.some((session) => session.id === state.activeSessionId)
          ? state.activeSessionId
          : null,
      };
    case 'session/update': {
      const nextSessions = state.sessions.map((session) =>
        session.id === action.session.id ? { ...session, ...action.session } : session,
      );
      if (!nextSessions.some((session) => session.id === action.session.id)) {
        nextSessions.unshift(action.session);
      }
      // Keep pinned sessions first client-side.
      nextSessions.sort((left, right) => {
        const leftPinned = left.isPinned === true;
        const rightPinned = right.isPinned === true;
        if (leftPinned !== rightPinned) {
          return leftPinned ? -1 : 1;
        }
        const leftTime = left.updatedAt ?? '';
        const rightTime = right.updatedAt ?? '';
        return rightTime.localeCompare(leftTime);
      });
      return { ...state, sessions: nextSessions };
    }
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
      }));
      return {
        ...state,
        messages,
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
      };
      return {
        ...state,
        messages: [...state.messages, userMessage],
        streaming: true,
        error: null,
      };
    }
    case 'host/status':
      return { ...state, hostReady: action.ready, hostMock: action.mock };
    case 'permission/show':
      return { ...state, permissionPrompt: action.prompt };
    case 'permission/clear':
      return { ...state, permissionPrompt: null };
    case 'error':
      return { ...state, error: action.message, streaming: false };
    case 'compaction/dismiss':
      return {
        ...state,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
      };
    case 'event':
      return applyAgentEvent(state, action.event);
    default:
      return state;
  }
}

function applyAgentEvent(state: ChatUiState, event: AgentEvent): ChatUiState {
  switch (event.type) {
    case 'message/start': {
      if (event.role !== 'assistant') {
        return state;
      }
      const message: ChatMessageUi = {
        id: event.messageId,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'streaming',
      };
      return { ...state, messages: [...state.messages, message], streaming: true };
    }
    case 'message/text_delta':
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        text: message.text + event.delta,
        status: 'streaming',
      }));
    case 'message/thinking_delta':
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        thinking: message.thinking + event.delta,
      }));
    case 'message/end': {
      const next = updateMessage(state, event.messageId, (message) => ({
        ...message,
        status: 'done',
      }));
      return { ...next, streaming: false };
    }
    case 'tool/start': {
      const lastAssistant = [...state.messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      if (!lastAssistant) {
        return state;
      }
      return updateMessage(state, lastAssistant.id, (message) => ({
        ...message,
        tools: [
          ...message.tools,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            output: '',
          },
        ],
      }));
    }
    case 'tool/update':
      return updateTool(state, event.toolCallId, (tool) => ({
        ...tool,
        output: tool.output + event.delta,
      }));
    case 'tool/end':
      return updateTool(state, event.toolCallId, (tool) => ({
        ...tool,
        status: event.isError ? 'error' : 'done',
      }));
    case 'permission/request':
      return state;
    case 'compaction/start':
      return {
        ...state,
        compacting: true,
        lastCompactionMessage: null,
        lastCompactionSummary: null,
        lastCompactionTokensBefore: null,
        lastCompactionTokensAfter: null,
        lastCompactionDurationMs: null,
      };
    case 'compaction/end': {
      const message =
        typeof event.message === 'string' && event.message
          ? event.message
          : event.ok === false
            ? 'Compaction finished with errors'
            : 'Context compacted';
      return {
        ...state,
        compacting: false,
        lastCompactionMessage: message,
        lastCompactionSummary:
          typeof event.summary === 'string' && event.summary ? event.summary : null,
        lastCompactionTokensBefore:
          typeof event.tokensBefore === 'number' ? event.tokensBefore : null,
        lastCompactionTokensAfter:
          typeof event.tokensAfter === 'number' ? event.tokensAfter : null,
        lastCompactionDurationMs:
          typeof event.durationMs === 'number' ? event.durationMs : null,
      };
    }
    case 'usage/update':
      return { ...state, contextUsage: event.usage };
    case 'error':
      return { ...state, error: event.message, streaming: false, compacting: false };
    default:
      return state;
  }
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

function updateTool(
  state: ChatUiState,
  toolCallId: string,
  updater: (tool: ToolCardUi) => ToolCardUi,
): ChatUiState {
  return {
    ...state,
    messages: state.messages.map((message) => ({
      ...message,
      tools: message.tools.map((tool) =>
        tool.toolCallId === toolCallId ? updater(tool) : tool,
      ),
    })),
  };
}
