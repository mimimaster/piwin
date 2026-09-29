import { AcpProtocolShapeError } from './acp-errors.js';
import type { JsonRpcConnection } from './json-rpc-connection.js';
import { GROK_XAI_METHODS } from './grok-acp-methods.js';
import type {
  AcpInitializeParams,
  AcpInitializeResult,
  AcpNewSessionParams,
  AcpPromptParams,
  AcpPromptResult,
  AcpSessionListParams,
  AcpSessionListResult,
  AcpSessionSetupParams,
  AcpSessionSetupResult,
  XaiSessionEntry,
} from './acp-protocol-types.js';

export class AcpClient {
  private readonly connection: JsonRpcConnection;

  constructor(connection: JsonRpcConnection) {
    this.connection = connection;
  }

  initialize(params: AcpInitializeParams): Promise<AcpInitializeResult> {
    return this.connection.request<unknown>('initialize', params).then((result) => {
      return parseInitializeResult(result);
    });
  }

  newSession(params: AcpNewSessionParams): Promise<AcpSessionSetupResult> {
    return this.connection.request<unknown>('session/new', params).then((result) => {
      return parseSessionSetupResult('session/new', result);
    });
  }

  loadSession(params: AcpSessionSetupParams): Promise<AcpSessionSetupResult> {
    return this.connection.request<unknown>('session/load', params).then((result) => {
      return parseSessionSetupResult('session/load', result);
    });
  }

  resumeSession(params: AcpSessionSetupParams): Promise<AcpSessionSetupResult> {
    return this.connection.request<unknown>('session/resume', params).then((result) => {
      return parseSessionSetupResult('session/resume', result);
    });
  }

  listSessions(params: AcpSessionListParams = {}): Promise<AcpSessionListResult> {
    return this.connection.request<unknown>('session/list', params).then((result) => {
      return parseSessionListResult(result);
    });
  }

  prompt(
    params: AcpPromptParams,
    options?: { signal?: AbortSignal },
  ): Promise<AcpPromptResult> {
    const requestOptions =
      options?.signal === undefined
        ? { timeoutMs: 0 }
        : { timeoutMs: 0, signal: options.signal };
    return this.connection
      .request<unknown>('session/prompt', params, requestOptions)
      .then((result) => parsePromptResult(result));
  }

  cancel(sessionId: string): void {
    this.connection.notify('session/cancel', { sessionId });
  }

  setMode(sessionId: string, modeId: string): Promise<unknown> {
    return this.connection.request('session/set_mode', { sessionId, modeId });
  }

  setConfigOption(sessionId: string, configId: string, value: string): Promise<unknown> {
    return this.connection.request('session/set_config_option', {
      sessionId,
      configId,
      value,
    });
  }

  async xaiListSessions(): Promise<XaiSessionEntry[]> {
    const result = await this.connection.request<unknown>(GROK_XAI_METHODS.sessionsList, {});
    return parseXaiSessionList(result);
  }

  xaiRenameSession(sessionId: string, title: string): Promise<unknown> {
    return this.connection.request(GROK_XAI_METHODS.sessionRename, { sessionId, title });
  }

  xaiDeleteSession(sessionId: string): Promise<unknown> {
    return this.connection.request(GROK_XAI_METHODS.sessionDelete, { sessionId });
  }

  async xaiInterject(sessionId: string, text: string): Promise<{ status: string }> {
    const result = await this.connection.request<unknown>(GROK_XAI_METHODS.interject, {
      sessionId,
      text,
    });
    return parseInterjectResult(result);
  }
}

function parseInitializeResult(value: unknown): AcpInitializeResult {
  const object = asObject(value, 'initialize', 'result');
  const protocolVersion = object.protocolVersion;
  if (typeof protocolVersion !== 'number') {
    throw new AcpProtocolShapeError('initialize', 'protocolVersion must be a number');
  }
  const result: AcpInitializeResult = { protocolVersion };
  if (Object.prototype.hasOwnProperty.call(object, 'agentCapabilities')) {
    result.agentCapabilities = object.agentCapabilities;
  }
  if (Object.prototype.hasOwnProperty.call(object, 'authMethods')) {
    const authMethods = parseAuthMethods(object.authMethods);
    if (authMethods !== undefined) {
      result.authMethods = authMethods;
    }
  }
  if (Object.prototype.hasOwnProperty.call(object, '_meta')) {
    result._meta = parseMeta(object._meta, 'initialize');
  }
  return result;
}

function parseAuthMethods(value: unknown): AcpInitializeResult['authMethods'] {
  if (!Array.isArray(value)) {
    throw new AcpProtocolShapeError('initialize', 'authMethods must be an array');
  }
  return value.map((entry, index) => {
    const object = asObject(entry, 'initialize', `authMethods[${index}]`);
    const id = object.id;
    if (typeof id !== 'string') {
      throw new AcpProtocolShapeError('initialize', `authMethods[${index}].id must be a string`);
    }
    const method: { id: string; name?: string; description?: string } = { id };
    if (typeof object.name === 'string') {
      method.name = object.name;
    }
    if (typeof object.description === 'string') {
      method.description = object.description;
    }
    return method;
  });
}

function parseSessionSetupResult(method: string, value: unknown): AcpSessionSetupResult {
  const object = asObject(value, method, 'result');
  const sessionId = object.sessionId;
  if (typeof sessionId !== 'string') {
    throw new AcpProtocolShapeError(method, 'sessionId must be a string');
  }
  const result: AcpSessionSetupResult = { sessionId };
  if (Object.prototype.hasOwnProperty.call(object, 'modes')) {
    result.modes = object.modes;
  }
  if (Object.prototype.hasOwnProperty.call(object, 'models')) {
    result.models = object.models;
  }
  if (Object.prototype.hasOwnProperty.call(object, 'configOptions')) {
    result.configOptions = object.configOptions;
  }
  if (Object.prototype.hasOwnProperty.call(object, '_meta')) {
    result._meta = parseMeta(object._meta, method);
  }
  return result;
}

function parseSessionListResult(value: unknown): AcpSessionListResult {
  const object = asObject(value, 'session/list', 'result');
  const sessions = object.sessions;
  if (!Array.isArray(sessions)) {
    throw new AcpProtocolShapeError('session/list', 'sessions must be an array');
  }
  const result: AcpSessionListResult = {
    sessions: sessions.map((entry, index) => asObject(entry, 'session/list', `sessions[${index}]`)),
  };
  if (typeof object.nextCursor === 'string') {
    result.nextCursor = object.nextCursor;
  }
  return result;
}

function parsePromptResult(value: unknown): AcpPromptResult {
  const object = asObject(value, 'session/prompt', 'result');
  const stopReason = object.stopReason;
  if (typeof stopReason !== 'string') {
    throw new AcpProtocolShapeError('session/prompt', 'stopReason must be a string');
  }
  const result: AcpPromptResult = { stopReason };
  if (Object.prototype.hasOwnProperty.call(object, '_meta')) {
    result._meta = parseMeta(object._meta, 'session/prompt');
  }
  return result;
}

function parseXaiSessionList(value: unknown): XaiSessionEntry[] {
  const object = asObject(value, GROK_XAI_METHODS.sessionsList, 'result');
  const sessions = extractXaiSessions(object);
  if (!Array.isArray(sessions)) {
    throw new AcpProtocolShapeError(GROK_XAI_METHODS.sessionsList, 'sessions must be an array');
  }
  const entries: XaiSessionEntry[] = [];
  for (const raw of sessions) {
    const entry = parseXaiSessionEntry(raw);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries;
}

function extractXaiSessions(object: Record<string, unknown>): unknown {
  if (Array.isArray(object.sessions)) {
    return object.sessions;
  }
  const nested = object.result;
  if (isPlainObject(nested) && Array.isArray(nested.sessions)) {
    return nested.sessions;
  }
  return undefined;
}

function parseXaiSessionEntry(value: unknown): XaiSessionEntry | undefined {
  if (!isPlainObject(value) || typeof value.sessionId !== 'string') {
    return undefined;
  }
  const entry: XaiSessionEntry = { sessionId: value.sessionId };
  if (Object.prototype.hasOwnProperty.call(value, 'title')) {
    entry.title = value.title;
  }
  if (typeof value.cwd === 'string') {
    entry.cwd = value.cwd;
  }
  if (typeof value.isWorktree === 'boolean') {
    entry.isWorktree = value.isWorktree;
  }
  if (typeof value.modelId === 'string') {
    entry.modelId = value.modelId;
  }
  if (typeof value.reasoningEffort === 'string') {
    entry.reasoningEffort = value.reasoningEffort;
  }
  if (typeof value.yolo === 'boolean') {
    entry.yolo = value.yolo;
  }
  if (typeof value.activity === 'string') {
    entry.activity = value.activity;
  }
  if (typeof value.resident === 'boolean') {
    entry.resident = value.resident;
  }
  if (typeof value.lastChangeUnixMs === 'number') {
    entry.lastChangeUnixMs = value.lastChangeUnixMs;
  }
  if (isPlainObject(value.origin)) {
    const origin: { kind?: string } = {};
    if (typeof value.origin.kind === 'string') {
      origin.kind = value.origin.kind;
    }
    entry.origin = origin;
  }
  return entry;
}

function parseInterjectResult(value: unknown): { status: string } {
  const object = asObject(value, GROK_XAI_METHODS.interject, 'result');
  // Grok wraps xAI extension results as `{ result: { ... } }`; accept both.
  const nested = object.result;
  const status = isPlainObject(nested) ? nested.status : object.status;
  if (typeof status !== 'string') {
    throw new AcpProtocolShapeError(GROK_XAI_METHODS.interject, 'status must be a string');
  }
  return { status };
}

function parseMeta(value: unknown, method: string): Record<string, unknown> {
  return asObject(value, method, '_meta');
}

function asObject(value: unknown, method: string, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new AcpProtocolShapeError(method, `${label} must be an object`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
