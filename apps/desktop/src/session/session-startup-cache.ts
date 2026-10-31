/** Disposable presentation data. Host transcripts remain the only history authority. */
import type { SessionScope } from '@piwin/contracts';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatMessageUi,
  type ChatUiState,
  type ToolCardUi,
} from '../conversation/chat-reducer.js';
import {
  createPresentationStore,
  type PresentationStorage,
} from '../conversation/presentation-storage.js';
import { retainBoundedTranscriptWindow } from '../conversation/transcript-page-cache.js';
import type { HostClient } from '../host/host-client.js';
import { sessionCacheHostKey } from './session-cache-host.js';
import { readSessionListSnapshot, snapshotRestoreActions } from './session-list-snapshot.js';
import { putWarmSessionSnapshot } from './session-warm-cache.js';

const VERSION = 1;
const KEY_PREFIX = 'piwin.desktop.session-startup.v1.';
const store = createPresentationStore('Session startup views');

export type SessionStartupSnapshot = {
  version: typeof VERSION;
  savedAt: string;
  sessionId: string;
  name: string;
  scope: SessionScope;
  messages: ChatMessageUi[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readScope(value: unknown): SessionScope | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'general') return { kind: 'general' };
  if (
    value.kind === 'project' &&
    typeof value.projectPath === 'string' &&
    value.projectPath.trim()
  ) {
    return { kind: 'project', projectPath: value.projectPath };
  }
  return undefined;
}

function readTool(value: unknown): ToolCardUi | undefined {
  if (
    !isRecord(value) ||
    typeof value.toolCallId !== 'string' ||
    typeof value.toolName !== 'string' ||
    typeof value.output !== 'string' ||
    (value.status !== 'done' && value.status !== 'error')
  )
    return undefined;
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    output: value.output,
    status: value.status,
  };
}

/** Cache text and settled tool output, never live work or media preview URLs. */
function readMessage(value: unknown): ChatMessageUi | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.text !== 'string' ||
    typeof value.thinking !== 'string' ||
    !Array.isArray(value.tools)
  )
    return undefined;
  const role = value.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool')
    return undefined;
  const tools = value.tools.map(readTool).filter((tool) => tool !== undefined);
  return {
    id: value.id,
    role,
    text: value.text,
    thinking: value.thinking,
    tools,
    attachments: [],
    status: value.status === 'error' ? 'error' : 'done',
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.transcriptIndex === 'number' && Number.isSafeInteger(value.transcriptIndex)
      ? { transcriptIndex: value.transcriptIndex }
      : {}),
    ...(isRecord(value.model) &&
    typeof value.model.providerId === 'string' &&
    typeof value.model.modelId === 'string'
      ? { model: { providerId: value.model.providerId, modelId: value.model.modelId } }
      : {}),
  };
}

export function buildSessionStartupSnapshot(state: ChatUiState): SessionStartupSnapshot | null {
  const sessionId = state.activeSessionId;
  if (!sessionId || state.transcriptOwnerSessionId !== sessionId || state.awaitingTranscript)
    return null;
  const messages = retainBoundedTranscriptWindow(
    state.messages.map(readMessage).filter((message) => message !== undefined),
  ).messages;
  if (messages.length === 0) return null;
  return {
    version: VERSION,
    savedAt: new Date().toISOString(),
    sessionId,
    name: state.sessionEntitiesById[sessionId]?.name ?? state.activeSessionMetadata?.name ?? '',
    scope: state.activeScope,
    messages,
  };
}

export function readSessionStartupSnapshot(
  hostKey: string,
  storage: PresentationStorage | null = store.defaultStorage(),
): SessionStartupSnapshot | undefined {
  if (storage === null) return undefined;
  const value = store.readJson(storage, `${KEY_PREFIX}${encodeURIComponent(hostKey)}`);
  if (
    !isRecord(value) ||
    value.version !== VERSION ||
    typeof value.savedAt !== 'string' ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId.trim() ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.messages)
  )
    return undefined;
  const scope = readScope(value.scope);
  if (scope === undefined) return undefined;
  const messages = retainBoundedTranscriptWindow(
    value.messages.map(readMessage).filter((message) => message !== undefined),
  ).messages;
  if (messages.length === 0) return undefined;
  return {
    version: VERSION,
    savedAt: value.savedAt,
    sessionId: value.sessionId,
    name: value.name,
    scope,
    messages,
  };
}

export function writeSessionStartupSnapshot(
  hostKey: string,
  snapshot: SessionStartupSnapshot | null,
  storage: PresentationStorage | null = store.defaultStorage(),
): void {
  if (storage !== null)
    store.writeJson(storage, `${KEY_PREFIX}${encodeURIComponent(hostKey)}`, snapshot);
}

/** First paint needs neither a socket, settings nor a live Agent runtime. */
export function createSessionStartupState(
  hostClient: Pick<HostClient, 'getTransport'> & Partial<Pick<HostClient, 'getRemoteTarget'>>,
  storage: PresentationStorage | null = store.defaultStorage(),
): ChatUiState {
  let state = createInitialChatUiState();
  const hostKey = sessionCacheHostKey(hostClient);
  if (hostKey === null || storage === null) return state;
  const list = readSessionListSnapshot(storage, hostKey);
  if (list !== undefined) {
    for (const action of snapshotRestoreActions(list)) state = chatUiReducer(state, action);
  }
  const snapshot = readSessionStartupSnapshot(hostKey, storage);
  if (snapshot === undefined) return state;
  state = {
    ...state,
    activeScope: snapshot.scope,
    projectPath: snapshot.scope.kind === 'project' ? snapshot.scope.projectPath : null,
    warmSessionCache: putWarmSessionSnapshot(state.warmSessionCache, {
      sessionId: snapshot.sessionId,
      messages: snapshot.messages,
      transcriptWindow: null,
      outline: [],
      runRecordsById: {},
      walkthroughsByMessageId: {},
      contextUsage: null,
    }),
  };
  state = chatUiReducer(state, {
    type: 'session/update',
    session: {
      id: snapshot.sessionId,
      name: snapshot.name,
      scope: snapshot.scope,
    },
  });
  state = chatUiReducer(state, {
    type: 'session/set',
    sessionId: snapshot.sessionId,
    awaitTranscript: true,
  });
  return { ...state, foregroundAdmission: 'unknown' };
}
