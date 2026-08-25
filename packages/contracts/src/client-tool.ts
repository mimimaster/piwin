/**
 * Negotiated client-device tool wire: capability advertisement, direct
 * request/result/cancel frames, and the transport-neutral execution port.
 *
 * Frames are point-to-point control traffic. They must never enter HostPush
 * sequencing, replay, hydration, or snapshots.
 */

export const APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID = 'apple-health.read-context.v1';

export const MAX_CLIENT_TOOL_CAPABILITIES = 32;
export const MAX_CLIENT_TOOL_CAPABILITY_ID_CHARS = 128;
export const MAX_CLIENT_TOOL_REQUEST_BYTES = 32 * 1024;
export const MAX_CLIENT_TOOL_RESULT_BYTES = 128 * 1024;
export const MAX_CLIENT_TOOL_CAPABILITIES_FRAME_BYTES = 8 * 1024;
export const CLIENT_TOOL_DEFAULT_DEADLINE_MS = 120_000;
export const CLIENT_TOOL_MAX_DEADLINE_MS = 180_000;
export const CLIENT_TOOL_CLOCK_SKEW_MS = 10 * 60 * 1000;
export const MAX_CLIENT_TOOL_PENDING_HOST = 32;
export const MAX_APPLE_HEALTH_PENDING_PER_DEVICE = 1;
export const MAX_CLIENT_TOOL_ID_CHARS = 256;
export const MAX_CLIENT_TOOL_JSON_DEPTH = 8;

export type ClientToolParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export type ClientToolCapabilityAdvertisement = {
  id: string;
  version: number;
};

export type ClientToolRequestDisplay = {
  title: '读取 Apple Health';
  metricLabels: string[];
  periodLabel: string;
  provider?: {
    id: string;
    label: string;
    processing: 'local' | 'external';
  };
  explicitTurnIntent: boolean;
};

export type ClientToolRequestFrame = {
  type: 'client-tool/request';
  requestId: string;
  capabilityId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  deadlineAt: string;
  timeoutMs: number;
  display: ClientToolRequestDisplay;
};

export type ClientToolResultStatus =
  | 'success'
  | 'permission-denied'
  | 'user-presence-required'
  | 'no-accessible-data'
  | 'unavailable'
  | 'cancelled'
  | 'failed';

export type ClientToolResultErrorCode =
  | 'local-policy-denied'
  | 'user-presence-required'
  | 'healthkit-unavailable'
  | 'healthkit-no-accessible-data'
  | 'healthkit-query-failed'
  | 'deadline-expired'
  | 'cancelled';

export type ClientToolResultFrame = {
  type: 'client-tool/result';
  requestId: string;
  status: ClientToolResultStatus;
  completedAt: string;
  result?: Record<string, unknown>;
  errorCode?: ClientToolResultErrorCode;
};

export type ClientToolCancelReason =
  | 'run-aborted'
  | 'deadline'
  | 'connection-replaced'
  | 'host-shutdown';

export type ClientToolCancelFrame = {
  type: 'client-tool/cancel';
  requestId: string;
  reason: ClientToolCancelReason;
};

export type ClientToolCapabilitiesFrame = {
  type: 'client-tool/capabilities';
  capabilities: readonly ClientToolCapabilityAdvertisement[];
  sentAt: string;
};

export type ClientToolWireFrame =
  | ClientToolRequestFrame
  | ClientToolResultFrame
  | ClientToolCancelFrame
  | ClientToolCapabilitiesFrame;

export type ClientToolExecutionRequest = {
  capabilityId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  deadlineMs: number;
  preferredDeviceId?: string;
  display: ClientToolRequestDisplay;
};

export type ClientToolExecutionFailureReason =
  | 'client-device-unavailable'
  | 'client-device-disconnected'
  | 'client-tool-timeout'
  | 'permission-denied'
  | 'user-presence-required'
  | 'no-accessible-data'
  | 'cancelled'
  | 'invalid-client-result'
  | 'client-tool-failed';

export type ClientToolExecutionOutcome =
  | { ok: true; deviceId: string; completedAt: string; result: Record<string, unknown> }
  | {
      ok: false;
      reason: ClientToolExecutionFailureReason;
      retryable: boolean;
    };

export interface ClientToolExecutionPort {
  execute(
    request: ClientToolExecutionRequest,
    signal: AbortSignal,
  ): Promise<ClientToolExecutionOutcome>;
}

const CAPABILITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const RESULT_STATUSES = new Set<ClientToolResultStatus>([
  'success',
  'permission-denied',
  'user-presence-required',
  'no-accessible-data',
  'unavailable',
  'cancelled',
  'failed',
]);

const ERROR_CODES = new Set<ClientToolResultErrorCode>([
  'local-policy-denied',
  'user-presence-required',
  'healthkit-unavailable',
  'healthkit-no-accessible-data',
  'healthkit-query-failed',
  'deadline-expired',
  'cancelled',
]);

const CANCEL_REASONS = new Set<ClientToolCancelReason>([
  'run-aborted',
  'deadline',
  'connection-replaced',
  'host-shutdown',
]);

const COMPATIBLE_ERROR_CODES: Record<
  Exclude<ClientToolResultStatus, 'success'>,
  ReadonlySet<ClientToolResultErrorCode>
> = {
  'permission-denied': new Set(['local-policy-denied']),
  'user-presence-required': new Set(['user-presence-required']),
  'no-accessible-data': new Set(['healthkit-no-accessible-data']),
  unavailable: new Set(['healthkit-unavailable', 'deadline-expired']),
  cancelled: new Set(['cancelled']),
  failed: new Set(['healthkit-query-failed']),
};

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidClientToolCapabilityId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_CLIENT_TOOL_CAPABILITY_ID_CHARS &&
    CAPABILITY_ID_PATTERN.test(id)
  );
}

export function parseClientToolCapabilityAdvertisements(
  value: unknown,
): ClientToolParseResult<{ capabilities: readonly ClientToolCapabilityAdvertisement[] }> {
  if (!Array.isArray(value)) {
    return fail('client-tool capabilities must be an array');
  }
  if (value.length > MAX_CLIENT_TOOL_CAPABILITIES) {
    return fail(`client-tool capabilities exceed ${MAX_CLIENT_TOOL_CAPABILITIES}`);
  }
  const seen = new Set<string>();
  const capabilities: ClientToolCapabilityAdvertisement[] = [];
  for (const item of value) {
    if (!isPlainRecord(item)) {
      return fail('client-tool capability must be a plain object');
    }
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('id') || !keys.includes('version')) {
      return fail('client-tool capability may only include id and version');
    }
    if (typeof item.id !== 'string' || !isValidClientToolCapabilityId(item.id)) {
      return fail('client-tool capability id is invalid');
    }
    if (
      typeof item.version !== 'number' ||
      !Number.isSafeInteger(item.version) ||
      item.version < 1
    ) {
      return fail('client-tool capability version must be a positive safe integer');
    }
    if (seen.has(item.id)) {
      return fail('client-tool capability ids must be unique');
    }
    seen.add(item.id);
    capabilities.push({ id: item.id, version: item.version });
  }
  return { ok: true, value: { capabilities } };
}

export function parseClientToolRequestFrame(
  value: unknown,
): ClientToolParseResult<ClientToolRequestFrame> {
  if (!isPlainRecord(value) || value.type !== 'client-tool/request') {
    return fail('client-tool/request type is required');
  }
  const requestId = parseBoundId(value.requestId, 'requestId');
  if (!requestId.ok) {
    return requestId;
  }
  if (typeof value.capabilityId !== 'string' || !isValidClientToolCapabilityId(value.capabilityId)) {
    return fail('client-tool/request capabilityId is invalid');
  }
  const sessionId = parseBoundId(value.sessionId, 'sessionId');
  if (!sessionId.ok) {
    return sessionId;
  }
  const runId = parseBoundId(value.runId, 'runId');
  if (!runId.ok) {
    return runId;
  }
  const toolCallId = parseBoundId(value.toolCallId, 'toolCallId');
  if (!toolCallId.ok) {
    return toolCallId;
  }
  if (!isPlainJsonValue(value.arguments, 0)) {
    return fail('client-tool/request arguments must be plain JSON');
  }
  if (!isRfc3339(value.deadlineAt)) {
    return fail('client-tool/request deadlineAt must be RFC 3339');
  }
  if (
    typeof value.timeoutMs !== 'number' ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > CLIENT_TOOL_MAX_DEADLINE_MS
  ) {
    return fail('client-tool/request timeoutMs is out of range');
  }
  const display = parseDisplay(value.display);
  if (!display.ok) {
    return display;
  }
  if (hasUnknownKeys(value, [
    'type',
    'requestId',
    'capabilityId',
    'sessionId',
    'runId',
    'toolCallId',
    'arguments',
    'deadlineAt',
    'timeoutMs',
    'display',
  ])) {
    return fail('client-tool/request has unknown fields');
  }
  return {
    ok: true,
    value: {
      type: 'client-tool/request',
      requestId: requestId.value,
      capabilityId: value.capabilityId,
      sessionId: sessionId.value,
      runId: runId.value,
      toolCallId: toolCallId.value,
      arguments: value.arguments as Record<string, unknown>,
      deadlineAt: value.deadlineAt,
      timeoutMs: value.timeoutMs,
      display: display.value,
    },
  };
}

export function parseClientToolResultFrame(
  value: unknown,
): ClientToolParseResult<ClientToolResultFrame> {
  if (!isPlainRecord(value) || value.type !== 'client-tool/result') {
    return fail('client-tool/result type is required');
  }
  const requestId = parseBoundId(value.requestId, 'requestId');
  if (!requestId.ok) {
    return requestId;
  }
  if (typeof value.status !== 'string' || !RESULT_STATUSES.has(value.status as ClientToolResultStatus)) {
    return fail('client-tool/result status is invalid');
  }
  const status = value.status as ClientToolResultStatus;
  if (!isRfc3339(value.completedAt)) {
    return fail('client-tool/result completedAt must be RFC 3339');
  }
  if (hasUnknownKeys(value, [
    'type',
    'requestId',
    'status',
    'completedAt',
    'result',
    'errorCode',
  ])) {
    return fail('client-tool/result has unknown fields');
  }
  if (status === 'success') {
    if (value.errorCode !== undefined) {
      return fail('successful client-tool/result forbids errorCode');
    }
    if (!isPlainRecord(value.result) || !isPlainJsonValue(value.result, 0)) {
      return fail('successful client-tool/result requires one result object');
    }
    return {
      ok: true,
      value: {
        type: 'client-tool/result',
        requestId: requestId.value,
        status,
        completedAt: value.completedAt,
        result: value.result,
      },
    };
  }
  if (value.result !== undefined) {
    return fail('failed client-tool/result forbids result');
  }
  if (value.errorCode !== undefined) {
    if (typeof value.errorCode !== 'string' || !ERROR_CODES.has(value.errorCode as ClientToolResultErrorCode)) {
      return fail('client-tool/result errorCode is invalid');
    }
    const compatible = COMPATIBLE_ERROR_CODES[status];
    if (!compatible.has(value.errorCode as ClientToolResultErrorCode)) {
      return fail('client-tool/result errorCode is not compatible with status');
    }
    return {
      ok: true,
      value: {
        type: 'client-tool/result',
        requestId: requestId.value,
        status,
        completedAt: value.completedAt,
        errorCode: value.errorCode as ClientToolResultErrorCode,
      },
    };
  }
  return {
    ok: true,
    value: {
      type: 'client-tool/result',
      requestId: requestId.value,
      status,
      completedAt: value.completedAt,
    },
  };
}

export function parseClientToolCancelFrame(
  value: unknown,
): ClientToolParseResult<ClientToolCancelFrame> {
  if (!isPlainRecord(value) || value.type !== 'client-tool/cancel') {
    return fail('client-tool/cancel type is required');
  }
  const requestId = parseBoundId(value.requestId, 'requestId');
  if (!requestId.ok) {
    return requestId;
  }
  if (typeof value.reason !== 'string' || !CANCEL_REASONS.has(value.reason as ClientToolCancelReason)) {
    return fail('client-tool/cancel reason is invalid');
  }
  if (hasUnknownKeys(value, ['type', 'requestId', 'reason'])) {
    return fail('client-tool/cancel has unknown fields');
  }
  return {
    ok: true,
    value: {
      type: 'client-tool/cancel',
      requestId: requestId.value,
      reason: value.reason as ClientToolCancelReason,
    },
  };
}

export function parseClientToolCapabilitiesFrame(
  value: unknown,
): ClientToolParseResult<ClientToolCapabilitiesFrame> {
  if (!isPlainRecord(value) || value.type !== 'client-tool/capabilities') {
    return fail('client-tool/capabilities type is required');
  }
  const parsed = parseClientToolCapabilityAdvertisements(value.capabilities);
  if (!parsed.ok) {
    return parsed;
  }
  if (!isRfc3339(value.sentAt)) {
    return fail('client-tool/capabilities sentAt must be RFC 3339');
  }
  if (hasUnknownKeys(value, ['type', 'capabilities', 'sentAt'])) {
    return fail('client-tool/capabilities has unknown fields');
  }
  return {
    ok: true,
    value: {
      type: 'client-tool/capabilities',
      capabilities: parsed.value.capabilities,
      sentAt: value.sentAt,
    },
  };
}

export function parseClientToolWireFrame(
  value: unknown,
): ClientToolParseResult<ClientToolWireFrame> {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    return fail('client-tool frame must be an object with a type');
  }
  switch (value.type) {
    case 'client-tool/request':
      return parseClientToolRequestFrame(value);
    case 'client-tool/result':
      return parseClientToolResultFrame(value);
    case 'client-tool/cancel':
      return parseClientToolCancelFrame(value);
    case 'client-tool/capabilities':
      return parseClientToolCapabilitiesFrame(value);
    default:
      return fail(`unknown client-tool frame type: ${value.type}`);
  }
}

export function clientToolFrameByteCap(type: ClientToolWireFrame['type']): number {
  switch (type) {
    case 'client-tool/request':
      return MAX_CLIENT_TOOL_REQUEST_BYTES;
    case 'client-tool/result':
      return MAX_CLIENT_TOOL_RESULT_BYTES;
    case 'client-tool/capabilities':
      return MAX_CLIENT_TOOL_CAPABILITIES_FRAME_BYTES;
    case 'client-tool/cancel':
      return MAX_CLIENT_TOOL_REQUEST_BYTES;
  }
}

export function isClientToolTimestampWithinSkew(input: {
  timestamp: string;
  issuedAtMs: number;
  deadlineAtMs: number;
  skewMs?: number;
}): boolean {
  if (!isRfc3339(input.timestamp)) {
    return false;
  }
  const skewMs = input.skewMs ?? CLIENT_TOOL_CLOCK_SKEW_MS;
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  return timestampMs >= input.issuedAtMs - skewMs && timestampMs <= input.deadlineAtMs + skewMs;
}

export function isRfc3339Timestamp(value: unknown): value is string {
  return isRfc3339(value);
}

export function isPlainJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_CLIENT_TOOL_JSON_DEPTH) {
    return false;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isPlainJsonValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_JSON_KEYS.has(key) || !isPlainJsonValue(nested, depth + 1)) {
      return false;
    }
  }
  return true;
}

function parseDisplay(value: unknown): ClientToolParseResult<ClientToolRequestDisplay> {
  if (!isPlainRecord(value)) {
    return fail('client-tool display must be a plain object');
  }
  if (value.title !== '读取 Apple Health') {
    return fail('client-tool display title must be trusted product copy');
  }
  if (
    !Array.isArray(value.metricLabels) ||
    value.metricLabels.length === 0 ||
    value.metricLabels.length > 8 ||
    value.metricLabels.some(
      (label) => typeof label !== 'string' || label.length === 0 || label.length > 64,
    )
  ) {
    return fail('client-tool display metricLabels are invalid');
  }
  if (
    typeof value.periodLabel !== 'string' ||
    value.periodLabel.length === 0 ||
    value.periodLabel.length > 128
  ) {
    return fail('client-tool display periodLabel is invalid');
  }
  if (typeof value.explicitTurnIntent !== 'boolean') {
    return fail('client-tool display explicitTurnIntent must be boolean');
  }
  const allowed = ['title', 'metricLabels', 'periodLabel', 'provider', 'explicitTurnIntent'];
  if (hasUnknownKeys(value, allowed)) {
    return fail('client-tool display has unknown fields');
  }
  const display: ClientToolRequestDisplay = {
    title: '读取 Apple Health',
    metricLabels: value.metricLabels as string[],
    periodLabel: value.periodLabel,
    explicitTurnIntent: value.explicitTurnIntent,
  };
  if (value.provider !== undefined) {
    if (!isPlainRecord(value.provider)) {
      return fail('client-tool display provider must be a plain object');
    }
    if (
      typeof value.provider.id !== 'string' ||
      value.provider.id.length === 0 ||
      value.provider.id.length > 128 ||
      typeof value.provider.label !== 'string' ||
      value.provider.label.length === 0 ||
      value.provider.label.length > 128 ||
      (value.provider.processing !== 'local' && value.provider.processing !== 'external')
    ) {
      return fail('client-tool display provider is invalid');
    }
    if (hasUnknownKeys(value.provider, ['id', 'label', 'processing'])) {
      return fail('client-tool display provider has unknown fields');
    }
    display.provider = {
      id: value.provider.id,
      label: value.provider.label,
      processing: value.provider.processing,
    };
  }
  return { ok: true, value: display };
}

function parseBoundId(value: unknown, field: string): ClientToolParseResult<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CLIENT_TOOL_ID_CHARS) {
    return fail(`client-tool ${field} is invalid`);
  }
  if (value !== value.trim()) {
    return fail(`client-tool ${field} is invalid`);
  }
  return { ok: true, value };
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).some((key) => !allowedSet.has(key) || FORBIDDEN_JSON_KEYS.has(key));
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
