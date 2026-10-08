import type {
  AgentEvent,
  AgentMessageRole,
  ModelRef,
  RemoteTranscriptMessage,
  RemoteTranscriptTool,
  ToolPresentation,
} from '@piwin/contracts';

/**
 * TUI transcript state: the durable page the Host returned plus the live
 * AgentEvent stream folded on top. Pure — rendering lives in transcript-view.
 *
 * Entries are replaced, never mutated, so the view can cache rendered lines by
 * entry identity.
 */

export type TranscriptTool = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
  presentation?: ToolPresentation;
};

export type TranscriptMessageEntry = {
  kind: 'message';
  id: string;
  role: AgentMessageRole;
  text: string;
  thinking: string;
  status: 'streaming' | 'done' | 'error';
  tools: TranscriptTool[];
  /** Run that produced this row; what a turn's file changes are filed under. */
  runId?: string;
  /** What a user turn carried besides text: file refs, attachments. */
  annotations?: string[];
  model?: ModelRef;
  /** Host-authored terminal line for a failed or cancelled response. */
  terminalMessage?: string;
  /** Tool-call arguments are streaming; the body is never sent, only a count. */
  composing?: { toolName?: string; argumentCharCount: number };
};

export type TranscriptNoticeEntry = {
  kind: 'notice';
  id: string;
  tone: 'info' | 'error';
  text: string;
};

export type TranscriptEntry = TranscriptMessageEntry | TranscriptNoticeEntry;

export type TranscriptState = {
  entries: TranscriptEntry[];
  /** Monotonic id source for locally authored notices. */
  noticeCount: number;
};

export const EMPTY_TRANSCRIPT: TranscriptState = { entries: [], noticeCount: 0 };

export function transcriptFromMessages(messages: readonly RemoteTranscriptMessage[]): TranscriptState {
  return { entries: messages.map(entryFromMessage), noticeCount: 0 };
}

/** Older page fetched through `olderCursor`; ids already present are kept as-is. */
export function prependOlderMessages(
  state: TranscriptState,
  messages: readonly RemoteTranscriptMessage[],
): TranscriptState {
  const known = new Set(state.entries.map((entry) => entry.id));
  const older = messages.filter((message) => !known.has(message.id)).map(entryFromMessage);
  return older.length === 0 ? state : { ...state, entries: [...older, ...state.entries] };
}

/** Echo the user's prompt before the Host confirms it; the Host row reuses this id. */
export function appendLocalUserMessage(
  state: TranscriptState,
  id: string,
  text: string,
  annotations: readonly string[] = [],
): TranscriptState {
  if (state.entries.some((entry) => entry.id === id)) return state;
  const entry = newMessage(id, 'user', { text, status: 'done' });
  if (annotations.length > 0) entry.annotations = [...annotations];
  return { ...state, entries: [...state.entries, entry] };
}

export function appendNotice(
  state: TranscriptState,
  tone: TranscriptNoticeEntry['tone'],
  text: string,
): TranscriptState {
  const noticeCount = state.noticeCount + 1;
  return {
    noticeCount,
    entries: [...state.entries, { kind: 'notice', id: `notice-${noticeCount}`, tone, text }],
  };
}

/**
 * A failure can reach the shell twice: as the turn's `error` event and as the
 * run's terminal record. The same words right after each other are one failure.
 */
export function appendNoticeOnce(
  state: TranscriptState,
  tone: TranscriptNoticeEntry['tone'],
  text: string,
): TranscriptState {
  const last = state.entries[state.entries.length - 1];
  if (last?.kind === 'notice' && last.tone === tone && last.text === text) return state;
  return appendNotice(state, tone, text);
}

/** A run ended without a `message/end` (abort, crash): nothing may stay "streaming". */
export function settleStreaming(state: TranscriptState): TranscriptState {
  if (!state.entries.some(isUnsettled)) return state;
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (!isUnsettled(entry) || entry.kind !== 'message') return entry;
      const settled: TranscriptMessageEntry = {
        ...entry,
        status: 'done',
        tools: entry.tools.map((tool) =>
          tool.status === 'running' ? { ...tool, status: 'error' } : tool,
        ),
      };
      delete settled.composing;
      return settled;
    }),
  };
}

export function applyAgentEvent(state: TranscriptState, event: AgentEvent): TranscriptState {
  switch (event.type) {
    case 'message/start': {
      // User turns carry no text on the event stream: they come from the local
      // echo or the durable page. Opening a row here would render an empty prompt.
      if (event.role !== 'assistant') return state;
      if (state.entries.some((entry) => entry.id === event.messageId)) return state;
      const entry = newMessage(event.messageId, event.role, { status: 'streaming' });
      if (event.model !== undefined) entry.model = event.model;
      if (event.runId !== undefined) entry.runId = event.runId;
      return { ...state, entries: [...state.entries, entry] };
    }
    case 'message/text_delta':
      return updateMessage(state, event.messageId, (entry) => ({
        ...withoutComposing(entry),
        text: entry.text + event.delta,
      }));
    case 'message/text_snapshot':
      return updateMessage(state, event.messageId, (entry) => ({ ...entry, text: event.text }));
    case 'message/thinking_delta':
      return updateMessage(state, event.messageId, (entry) => ({
        ...entry,
        thinking: entry.thinking + event.delta,
      }));
    case 'message/tool_args_progress':
      return updateMessage(state, event.messageId, (entry) => ({
        ...entry,
        composing: {
          argumentCharCount: event.argumentCharCount,
          ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
        },
      }));
    case 'message/end':
      return updateMessage(state, event.messageId, (entry) => ({
        ...withoutComposing(entry),
        status: entry.status === 'error' ? 'error' : 'done',
      }));
    case 'tool/start':
      return upsertTool(state, event.responseMessageId, event.toolCallId, (tool) => ({
        ...(tool ?? { toolCallId: event.toolCallId, output: '' }),
        toolName: event.toolName,
        status: 'running',
        ...presentationPatch(event.presentation),
      }));
    case 'tool/update':
      return upsertTool(state, event.responseMessageId, event.toolCallId, (tool) => ({
        ...(tool ?? { toolCallId: event.toolCallId, toolName: 'tool', status: 'running' as const }),
        output: (tool?.output ?? '') + event.delta,
        ...presentationPatch(event.presentation),
      }));
    case 'tool/end':
      return upsertTool(state, event.responseMessageId, event.toolCallId, (tool) => ({
        ...(tool ?? { toolCallId: event.toolCallId, toolName: 'tool', output: '' }),
        status: event.isError ? 'error' : 'done',
        ...presentationPatch(event.presentation),
      }));
    case 'session/aborted':
      return appendNotice(settleStreaming(state), 'info', '已中断');
    case 'error':
      return appendNoticeOnce(settleStreaming(state), 'error', event.message);
    case 'model/retry':
      if (event.phase !== 'waiting') return state;
      return appendNotice(
        state,
        'info',
        `模型请求重试 ${event.attempt}${event.maxAttempts === undefined ? '' : `/${event.maxAttempts}`}`,
      );
    case 'compaction/start':
      return appendNotice(state, 'info', '正在压缩上下文…');
    case 'compaction/end':
      if (event.noOp === true) return state;
      return appendNotice(
        state,
        event.ok === false ? 'error' : 'info',
        event.ok === false ? `压缩失败${event.message ? `：${event.message}` : ''}` : '上下文已压缩',
      );
    default:
      return state;
  }
}

function entryFromMessage(message: RemoteTranscriptMessage): TranscriptMessageEntry {
  const entry = newMessage(message.id, message.role, {
    text: message.text,
    thinking: message.thinking ?? '',
    status: message.status,
    tools: (message.tools ?? []).map(toolFromRemote),
  });
  if (message.model !== undefined) entry.model = message.model;
  if (message.runId !== undefined) entry.runId = message.runId;
  const attachmentCount = message.attachments?.length ?? message.attachmentCount ?? 0;
  // History keeps attachment rows, not the file refs a turn was sent with.
  if (attachmentCount > 0) entry.annotations = [`${attachmentCount} 个附件`];
  if (message.terminalMessage !== undefined) entry.terminalMessage = message.terminalMessage;
  return entry;
}

function toolFromRemote(tool: RemoteTranscriptTool): TranscriptTool {
  return {
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    status: tool.status,
    output: tool.output,
    ...presentationPatch(tool.presentation),
  };
}

function newMessage(
  id: string,
  role: AgentMessageRole,
  fields: Partial<Pick<TranscriptMessageEntry, 'text' | 'thinking' | 'status' | 'tools'>>,
): TranscriptMessageEntry {
  return {
    kind: 'message',
    id,
    role,
    text: fields.text ?? '',
    thinking: fields.thinking ?? '',
    status: fields.status ?? 'done',
    tools: fields.tools ?? [],
  };
}

function presentationPatch(presentation: ToolPresentation | undefined): { presentation?: ToolPresentation } {
  return presentation === undefined ? {} : { presentation };
}

function withoutComposing(entry: TranscriptMessageEntry): TranscriptMessageEntry {
  if (entry.composing === undefined) return entry;
  const next = { ...entry };
  delete next.composing;
  return next;
}

function isUnsettled(entry: TranscriptEntry): boolean {
  return (
    entry.kind === 'message' &&
    (entry.status === 'streaming' ||
      entry.composing !== undefined ||
      entry.tools.some((tool) => tool.status === 'running'))
  );
}

function updateMessage(
  state: TranscriptState,
  messageId: string,
  update: (entry: TranscriptMessageEntry) => TranscriptMessageEntry,
): TranscriptState {
  const index = findMessageIndex(state.entries, messageId);
  if (index === -1) {
    // A delta for a row outside the loaded page (attached mid-run): open it
    // rather than drop live output.
    const opened = update(newMessage(messageId, 'assistant', { status: 'streaming' }));
    return { ...state, entries: [...state.entries, opened] };
  }
  const entries = state.entries.slice();
  entries[index] = update(entries[index] as TranscriptMessageEntry);
  return { ...state, entries };
}

function upsertTool(
  state: TranscriptState,
  responseMessageId: string | undefined,
  toolCallId: string,
  update: (tool: TranscriptTool | undefined) => TranscriptTool,
): TranscriptState {
  const ownerIndex = findToolOwnerIndex(state.entries, responseMessageId, toolCallId);
  if (ownerIndex === -1) {
    const owner = newMessage(responseMessageId ?? `tools-${toolCallId}`, 'assistant', {
      status: 'streaming',
      tools: [update(undefined)],
    });
    return { ...state, entries: [...state.entries, owner] };
  }
  const owner = state.entries[ownerIndex] as TranscriptMessageEntry;
  const toolIndex = owner.tools.findIndex((tool) => tool.toolCallId === toolCallId);
  const tools = owner.tools.slice();
  if (toolIndex === -1) tools.push(update(undefined));
  else tools[toolIndex] = update(tools[toolIndex]);
  const entries = state.entries.slice();
  entries[ownerIndex] = { ...withoutComposing(owner), tools };
  return { ...state, entries };
}

function findMessageIndex(entries: readonly TranscriptEntry[], messageId: string): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === 'message' && entry.id === messageId) return index;
  }
  return -1;
}

/** Owner = the call's existing row, else the named response, else the latest assistant row. */
function findToolOwnerIndex(
  entries: readonly TranscriptEntry[],
  responseMessageId: string | undefined,
  toolCallId: string,
): number {
  let latestAssistant = -1;
  let named = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== 'message') continue;
    if (entry.tools.some((tool) => tool.toolCallId === toolCallId)) return index;
    if (named === -1 && responseMessageId !== undefined && entry.id === responseMessageId) named = index;
    if (latestAssistant === -1 && entry.role === 'assistant') latestAssistant = index;
  }
  if (named !== -1) return named;
  return responseMessageId === undefined ? latestAssistant : -1;
}
