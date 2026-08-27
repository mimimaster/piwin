/**
 * Structured Agent failure. Prose is display detail, never classification
 * authority. API keys, request headers, and raw response bodies stay out.
 */

export const AGENT_FAILURE_ORIGINS = ['provider', 'transport', 'protocol', 'runtime'] as const;

export type AgentFailureOrigin = (typeof AGENT_FAILURE_ORIGINS)[number];

export const AGENT_FAILURE_CODES = [
  'provider-authentication',
  'provider-quota',
  'provider-rate-limit',
  'provider-http-error',
  'provider-unavailable',
  'model-request-timeout',
  'model-stream-missing-finish',
  'model-stream-stalled',
  'context-limit-exceeded',
  'backend-worker-crash',
  'backend-protocol-error',
  'unknown-agent-failure',
] as const;

export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number];

export const AGENT_FAILURE_MESSAGE_MAX_CHARS = 500;
export const AGENT_FAILURE_NATIVE_NAME_MAX_CHARS = 80;

export type AgentFailure = {
  code: AgentFailureCode;
  origin: AgentFailureOrigin;
  message: string;
  retriable: boolean;
  httpStatus?: number;
  nativeName?: string;
};

const ORIGIN_SET: ReadonlySet<string> = new Set(AGENT_FAILURE_ORIGINS);
const CODE_SET: ReadonlySet<string> = new Set(AGENT_FAILURE_CODES);

const SECRET_FRAGMENT =
  /(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|api[_-]?key\s*[:=]\s*\S+)/gi;

export function isAgentFailureOrigin(value: unknown): value is AgentFailureOrigin {
  return typeof value === 'string' && ORIGIN_SET.has(value);
}

export function isAgentFailureCode(value: unknown): value is AgentFailureCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

export function boundAgentFailureText(value: string, maxChars: number): string {
  const redacted = value.replace(SECRET_FRAGMENT, '[redacted]');
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return redacted.slice(0, maxChars);
}

export function createUnknownAgentFailure(
  message: string,
  options?: { retriable?: boolean },
): AgentFailure {
  return {
    code: 'unknown-agent-failure',
    origin: 'runtime',
    message: boundAgentFailureText(message, AGENT_FAILURE_MESSAGE_MAX_CHARS),
    retriable: options?.retriable === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isAgentFailure(value: unknown): value is AgentFailure {
  if (!isRecord(value)) {
    return false;
  }
  if (!isAgentFailureCode(value.code) || !isAgentFailureOrigin(value.origin)) {
    return false;
  }
  if (typeof value.message !== 'string' || typeof value.retriable !== 'boolean') {
    return false;
  }
  if (value.httpStatus !== undefined && typeof value.httpStatus !== 'number') {
    return false;
  }
  if (value.nativeName !== undefined && typeof value.nativeName !== 'string') {
    return false;
  }
  return true;
}

/** Bound and redact a known failure; never invent a more specific code. */
export function sanitizeAgentFailure(failure: AgentFailure): AgentFailure {
  const httpStatus =
    typeof failure.httpStatus === 'number' && Number.isFinite(failure.httpStatus)
      ? failure.httpStatus
      : undefined;
  const nativeName =
    typeof failure.nativeName === 'string' && failure.nativeName.length > 0
      ? boundAgentFailureText(failure.nativeName, AGENT_FAILURE_NATIVE_NAME_MAX_CHARS)
      : undefined;
  return {
    code: failure.code,
    origin: failure.origin,
    message: boundAgentFailureText(failure.message, AGENT_FAILURE_MESSAGE_MAX_CHARS),
    retriable: failure.retriable,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(nativeName === undefined ? {} : { nativeName }),
  };
}

/**
 * Compatibility decode. Legacy frames without a structured failure become
 * `unknown-agent-failure`. Callers must not guess a more specific code from prose.
 */
export function normalizeAgentFailure(value: unknown, fallbackMessage = ''): AgentFailure {
  if (isAgentFailure(value)) {
    return sanitizeAgentFailure(value);
  }
  return createUnknownAgentFailure(fallbackMessage);
}

export type AgentErrorEvent = {
  type: 'error';
  message: string;
  retriable?: boolean;
  runId?: string;
  failure?: AgentFailure;
};

export function normalizeAgentErrorEvent(event: AgentErrorEvent): AgentErrorEvent {
  const failure = normalizeAgentFailure(event.failure, event.message);
  return {
    type: 'error',
    message: boundAgentFailureText(event.message, AGENT_FAILURE_MESSAGE_MAX_CHARS),
    retriable: event.retriable ?? failure.retriable,
    failure,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
  };
}
