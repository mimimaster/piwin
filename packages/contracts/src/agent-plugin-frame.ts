import { isAgentPromptOutcome, type AgentPromptOutcome } from './agent-prompt-outcome.js';
import { isAgentPluginRelativePath } from './agent-plugin-manifest.js';
import {
  AGENT_PLUGIN_MAX_FRAME_BYTES, AGENT_PLUGIN_METHODS, AGENT_PLUGIN_PROTOCOL_VERSION,
  type AgentPluginFrame, type AgentPluginMediaProposal, type AgentPluginMethod, type AgentPluginScope,
} from './agent-plugin-protocol.js';

export class AgentPluginProtocolError extends Error {
  override readonly name = 'AgentPluginProtocolError';
}

function fail(reason: string): never {
  throw new AgentPluginProtocolError(`agent-plugin-protocol-error: ${reason}`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,160}$/.test(value);
}
function parseScope(value: unknown): AgentPluginScope {
  if (!isRecord(value)) return fail('invalid scope');
  if (value.kind === 'plugin' && Object.keys(value).length === 1) return { kind: 'plugin' };
  if (value.kind === 'session' && isIdentity(value.sessionId) && isIdentity(value.runtimeGenerationId) &&
      Object.keys(value).length === 3) {
    return { kind: 'session', sessionId: value.sessionId, runtimeGenerationId: value.runtimeGenerationId };
  }
  return fail('invalid session identity');
}
function sameScope(left: AgentPluginScope, right: AgentPluginScope): boolean {
  return left.kind === 'plugin' ? right.kind === 'plugin' : right.kind === 'session' &&
    left.sessionId === right.sessionId && left.runtimeGenerationId === right.runtimeGenerationId;
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isMethod(value: unknown): value is AgentPluginMethod {
  return typeof value === 'string' && AGENT_PLUGIN_METHODS.some((method) => method === value);
}
function isPluginMethod(method: AgentPluginMethod): boolean {
  return method.startsWith('plugin/') || method.startsWith('catalog/') || method === 'check';
}
const FAILURE_CODES = ['invalid-request', 'unsupported', 'unavailable', 'backend-error', 'cancelled', 'migration-required'] as const;

export type AgentPluginFrameExpectation = {
  scope?: AgentPluginScope;
  requestId?: string;
  method?: AgentPluginMethod;
  kind?: AgentPluginFrame['kind'];
};

/** A valid envelope never implies that its unknown method payload is safe or correctly typed. */
export function parseAgentPluginFrame(line: string, expected: AgentPluginFrameExpectation = {}): AgentPluginFrame {
  if (new TextEncoder().encode(line).byteLength > AGENT_PLUGIN_MAX_FRAME_BYTES || /[\r\n]/.test(line)) {
    return fail('invalid frame size or framing');
  }
  let value: unknown;
  try { value = JSON.parse(line) as unknown; } catch { return fail('invalid JSON'); }
  if (!isRecord(value) || value.protocolVersion !== AGENT_PLUGIN_PROTOCOL_VERSION) return fail('unsupported protocol');
  const scope = parseScope(value.scope);
  if (expected.scope && !sameScope(scope, expected.scope)) return fail('stale or foreign generation');
  if (expected.kind && value.kind !== expected.kind) return fail('unexpected frame kind');
  if (value.kind === 'event') {
    if (scope.kind !== 'session' || !('emission' in value) ||
        !hasOnlyKeys(value, ['protocolVersion', 'kind', 'scope', 'emission']) || expected.requestId || expected.method) {
      return fail('invalid notification');
    }
    return { protocolVersion: 1, kind: 'event', scope, emission: value.emission };
  }
  if ((value.kind !== 'request' && value.kind !== 'response') || !isIdentity(value.requestId) || !isMethod(value.method)) {
    return fail('invalid request correlation');
  }
  if ((scope.kind === 'plugin') !== isPluginMethod(value.method)) return fail('method scope mismatch');
  if ((expected.requestId && value.requestId !== expected.requestId) || (expected.method && value.method !== expected.method)) {
    return fail('response correlation mismatch');
  }
  const base = { protocolVersion: 1 as const, scope, requestId: value.requestId, method: value.method };
  if (value.kind === 'request') {
    if (!('params' in value) || !hasOnlyKeys(value, ['protocolVersion', 'kind', 'scope', 'requestId', 'method', 'params'])) {
      return fail('invalid request envelope');
    }
    return { ...base, kind: 'request', params: value.params };
  }
  if (value.ok === true && 'result' in value && hasOnlyKeys(value, ['protocolVersion', 'kind', 'scope', 'requestId', 'method', 'ok', 'result'])) {
    return { ...base, kind: 'response', ok: true, result: value.result };
  }
  if (value.ok === false && hasOnlyKeys(value, ['protocolVersion', 'kind', 'scope', 'requestId', 'method', 'ok', 'error']) &&
      isRecord(value.error)) {
    const error = value.error;
    if (hasOnlyKeys(error, ['code', 'message']) && typeof error.message === 'string') {
      const code = FAILURE_CODES.find((candidate) => candidate === error.code);
      if (code) return { ...base, kind: 'response', ok: false, error: { code, message: error.message } };
    }
  }
  return fail('invalid response envelope');
}

/** This is the only prompt completion payload: an event can never terminalize a Host Run. */
export function parseAgentPluginPromptOutcome(value: unknown): AgentPromptOutcome {
  return isAgentPromptOutcome(value) ? value : fail('invalid prompt outcome');
}

export function parseAgentPluginMediaProposal(value: unknown): AgentPluginMediaProposal {
  if (!isRecord(value) || !hasOnlyKeys(value, ['directoryId', 'relativePath', 'kind', 'importKey', 'prompt', 'createdAt']) ||
      typeof value.directoryId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.directoryId) ||
      !isAgentPluginRelativePath(value.relativePath) || (value.kind !== 'image' && value.kind !== 'video') ||
      typeof value.importKey !== 'string' || !value.importKey || value.importKey.length > 512 ||
      (value.prompt !== undefined && typeof value.prompt !== 'string') ||
      (value.createdAt !== undefined && (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))))) {
    return fail('invalid media proposal');
  }
  return {
    directoryId: value.directoryId, relativePath: value.relativePath, kind: value.kind, importKey: value.importKey,
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
  };
}
