/**
 * Host wire for bounded native backend user-input (request push + respond).
 *
 * Correlation authority stays on the Host request id. Plugin frame request ids
 * remain a bridge detail and are never a second source of truth for clients.
 */
import { AGENT_CLI_MAX_SESSION_ID_CHARS } from './agent-cli.js';
import {
  BACKEND_USER_INPUT_MAX_JSON_BYTES,
  parseBackendUserInputRequest,
  parseBackendUserInputResult,
  type BackendUserInputRequest,
  type BackendUserInputResult,
} from './backend-user-input.js';

export type BackendUserInputRequestPush = {
  type: 'session/backend-input-request';
  sessionId: string;
  requestId: string;
  generationId: string;
  request: BackendUserInputRequest;
  runId?: string;
};

export type BackendUserInputSettledPush = {
  type: 'session/backend-input-settled';
  sessionId: string;
  requestId: string;
  generationId: string;
  result: BackendUserInputResult;
  runId?: string;
};

export type BackendUserInputRespondCommand = {
  id?: string;
  type: 'session/backend-input-respond';
  sessionId: string;
  requestId: string;
  generationId: string;
  result: BackendUserInputResult;
  runId?: string;
};

const RESPOND_KEYS = ['id', 'type', 'sessionId', 'requestId', 'generationId', 'result', 'runId'] as const;

const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= AGENT_CLI_MAX_SESSION_ID_CHARS &&
    !value.includes('\0') &&
    !/[\r\n]/.test(value);
}

function jsonByteLength(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Remote/command admission for `session/backend-input-respond`.
 * Result is re-validated against the Host-held original request at settle time.
 */
export function isBackendUserInputRespondCommand(value: unknown): value is BackendUserInputRespondCommand {
  if (!isRecord(value) || value.type !== 'session/backend-input-respond' || !hasOnlyKeys(value, RESPOND_KEYS)) {
    return false;
  }
  if (value.id !== undefined && !isBoundedId(value.id)) {
    return false;
  }
  if (!isBoundedId(value.sessionId) || !isBoundedId(value.requestId) || !isBoundedId(value.generationId)) {
    return false;
  }
  if (value.runId !== undefined && !isBoundedId(value.runId)) {
    return false;
  }
  if (!isRecord(value.result) || jsonByteLength(value.result) > BACKEND_USER_INPUT_MAX_JSON_BYTES) {
    return false;
  }
  // Shape-only gate: cancelled or answers array. Exact match uses the stored request.
  if (value.result.cancelled === true) {
    return Object.keys(value.result).length === 1;
  }
  return Array.isArray(value.result.answers);
}

/** Parse a push body for tests and remote guards without trusting unknown keys. */
export function parseBackendUserInputRequestPush(value: unknown): BackendUserInputRequestPush | undefined {
  if (!isRecord(value) || value.type !== 'session/backend-input-request') {
    return undefined;
  }
  if (!isBoundedId(value.sessionId) || !isBoundedId(value.requestId) || !isBoundedId(value.generationId)) {
    return undefined;
  }
  if (value.runId !== undefined && !isBoundedId(value.runId)) {
    return undefined;
  }
  const request = parseBackendUserInputRequest(value.request);
  if (request === undefined) {
    return undefined;
  }
  return {
    type: 'session/backend-input-request',
    sessionId: value.sessionId,
    requestId: value.requestId,
    generationId: value.generationId,
    request,
    ...(value.runId !== undefined ? { runId: value.runId } : {}),
  };
}

export function parseBackendUserInputSettledPush(
  value: unknown,
  request: BackendUserInputRequest,
): BackendUserInputSettledPush | undefined {
  if (!isRecord(value) || value.type !== 'session/backend-input-settled') {
    return undefined;
  }
  if (!isBoundedId(value.sessionId) || !isBoundedId(value.requestId) || !isBoundedId(value.generationId)) {
    return undefined;
  }
  if (value.runId !== undefined && !isBoundedId(value.runId)) {
    return undefined;
  }
  const result = parseBackendUserInputResult(value.result, request);
  if (result === undefined) {
    return undefined;
  }
  return {
    type: 'session/backend-input-settled',
    sessionId: value.sessionId,
    requestId: value.requestId,
    generationId: value.generationId,
    result,
    ...(value.runId !== undefined ? { runId: value.runId } : {}),
  };
}
