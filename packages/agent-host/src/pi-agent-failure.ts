/**
 * Map Pi-native error facts to AgentFailure. Message matching is the last
 * fallback and stays inside agent-host.
 */

import {
  createUnknownAgentFailure,
  sanitizeAgentFailure,
  type AgentFailure,
  type AgentFailureCode,
  type AgentFailureOrigin,
} from '@piwin/contracts';
import { readNumber, readString, readUpstreamErrorMessage } from './pi-event-read.js';

const PROTOCOL_MISSING_FINISH = /stream ended without finish_reason/i;
const CONNECTION_ERROR_MESSAGE = /^connection error\b/i;
const CONNECTION_TRANSPORT_HINT =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|fetch failed|network\s*error|socket hang up/i;
const CONNECTION_NATIVE_NAMES = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'FetchError',
  'ConnectTimeoutError',
]);

export function readHttpStatusFromMessage(message: string): number | undefined {
  const match = /(?:^|\b)([1-5]\d{2})(?:\b|:)/.exec(message);
  if (!match) {
    return undefined;
  }
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}

export function agentFailureFromPiFacts(input: {
  errorMessage?: string;
  httpStatus?: number;
  nativeName?: string;
  provider?: string;
  baseUrl?: string;
}): AgentFailure {
  const rawMessage = input.errorMessage?.trim() || 'unknown agent failure';
  const httpStatus = input.httpStatus ?? readHttpStatusFromMessage(rawMessage);
  const nativeName = input.nativeName?.trim();
  const provider = input.provider?.trim();
  const baseUrl = input.baseUrl?.trim();
  // Classify from the raw provider prose; only the display message is enriched.
  const message = enrichConnectionFailureMessage(rawMessage, { provider, baseUrl });
  const fromStatus = failureFromHttpStatus(httpStatus);
  if (fromStatus) {
    return sanitizeAgentFailure({
      ...fromStatus,
      message,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(nativeName ? { nativeName } : {}),
    });
  }
  const fromNative = failureFromNativeIdentity(nativeName, rawMessage);
  if (fromNative) {
    return sanitizeAgentFailure({
      ...fromNative,
      message,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(nativeName ? { nativeName } : {}),
    });
  }
  const fromMessage = failureFromLegacyMessage(rawMessage);
  if (fromMessage) {
    return sanitizeAgentFailure({
      ...fromMessage,
      message,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(nativeName ? { nativeName } : {}),
    });
  }
  return sanitizeAgentFailure({
    ...createUnknownAgentFailure(message),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(nativeName ? { nativeName } : {}),
  });
}

export function agentFailureFromPiEvent(...sources: unknown[]): AgentFailure {
  const errorMessage = readUpstreamErrorMessage(...sources);
  let httpStatus: number | undefined;
  let nativeName: string | undefined;
  let provider: string | undefined;
  let baseUrl: string | undefined;
  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }
    const record = source as Record<string, unknown>;
    httpStatus ??= readNumber(record.status) ?? readNumber(record.statusCode);
    nativeName ??= readString(record.name) ?? readString(record.code);
    provider ??= readString(record.provider);
    baseUrl ??= readString(record.baseUrl) ?? readString(record.baseURL);
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const errorRecord = nested as Record<string, unknown>;
      httpStatus ??= readNumber(errorRecord.status) ?? readNumber(errorRecord.statusCode);
      nativeName ??= readString(errorRecord.name) ?? readString(errorRecord.code);
      provider ??= readString(errorRecord.provider);
      baseUrl ??= readString(errorRecord.baseUrl) ?? readString(errorRecord.baseURL);
    }
  }
  return agentFailureFromPiFacts({
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(nativeName === undefined ? {} : { nativeName }),
    ...(provider === undefined ? {} : { provider }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
}

export function enrichConnectionFailureMessage(
  message: string,
  context: { provider?: string | undefined; baseUrl?: string | undefined },
): string {
  if (!CONNECTION_ERROR_MESSAGE.test(message) && !CONNECTION_TRANSPORT_HINT.test(message)) {
    return message;
  }
  const parts: string[] = [];
  if (context.provider && context.provider.length > 0) {
    parts.push(context.provider);
  }
  if (context.baseUrl && context.baseUrl.length > 0) {
    parts.push(context.baseUrl);
  }
  if (parts.length === 0) {
    return message;
  }
  if (CONNECTION_ERROR_MESSAGE.test(message)) {
    return `Connection error (${parts.join(' · ')})`;
  }
  return `${message} (${parts.join(' · ')})`;
}

function failureFromHttpStatus(
  httpStatus: number | undefined,
): Pick<AgentFailure, 'code' | 'origin' | 'retriable'> | undefined {
  if (httpStatus === undefined) {
    return undefined;
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'provider-authentication', origin: 'provider', retriable: false };
  }
  if (httpStatus === 429) {
    return { code: 'provider-rate-limit', origin: 'provider', retriable: true };
  }
  if (httpStatus === 402) {
    return { code: 'provider-quota', origin: 'provider', retriable: false };
  }
  if (httpStatus >= 500 && httpStatus <= 599) {
    return { code: 'provider-unavailable', origin: 'provider', retriable: true };
  }
  if (httpStatus >= 400 && httpStatus <= 499) {
    return {
      code: 'provider-http-error',
      origin: 'provider',
      retriable: httpStatus === 408 || httpStatus === 409,
    };
  }
  return undefined;
}

function failureFromNativeIdentity(
  nativeName: string | undefined,
  message: string,
): Pick<AgentFailure, 'code' | 'origin' | 'retriable'> | undefined {
  if (PROTOCOL_MISSING_FINISH.test(message)) {
    return { code: 'model-stream-missing-finish', origin: 'protocol', retriable: true };
  }
  if (nativeName === 'AbortError' || nativeName === 'APIUserAbortError') {
    return { code: 'unknown-agent-failure', origin: 'transport', retriable: false };
  }
  if (nativeName !== undefined && CONNECTION_NATIVE_NAMES.has(nativeName)) {
    return { code: 'provider-unavailable', origin: 'provider', retriable: true };
  }
  return undefined;
}

function failureFromLegacyMessage(
  message: string,
): Pick<AgentFailure, 'code' | 'origin' | 'retriable'> | undefined {
  if (PROTOCOL_MISSING_FINISH.test(message)) {
    return { code: 'model-stream-missing-finish', origin: 'protocol', retriable: true };
  }
  if (/invalid authentication|unauthorized|authentication/i.test(message)) {
    return { code: 'provider-authentication', origin: 'provider', retriable: false };
  }
  if (/rate limit|too many requests/i.test(message)) {
    return { code: 'provider-rate-limit', origin: 'provider', retriable: true };
  }
  if (/\bquota\b|billing|insufficient (?:quota|credit)/i.test(message)) {
    return { code: 'provider-quota', origin: 'provider', retriable: false };
  }
  if (/context (?:length|window)|too many tokens|maximum context/i.test(message)) {
    return { code: 'context-limit-exceeded', origin: 'provider', retriable: false };
  }
  if (/timed? ?out|deadline exceeded/i.test(message)) {
    return { code: 'model-request-timeout', origin: 'transport', retriable: true };
  }
  if (CONNECTION_ERROR_MESSAGE.test(message) || CONNECTION_TRANSPORT_HINT.test(message)) {
    return { code: 'provider-unavailable', origin: 'provider', retriable: true };
  }
  return undefined;
}

export function agentFailureOriginForCode(code: AgentFailureCode): AgentFailureOrigin {
  switch (code) {
    case 'provider-authentication':
    case 'provider-quota':
    case 'provider-rate-limit':
    case 'provider-http-error':
    case 'provider-unavailable':
    case 'context-limit-exceeded':
      return 'provider';
    case 'model-request-timeout':
    case 'model-stream-stalled':
      return 'transport';
    case 'model-stream-missing-finish':
    case 'backend-protocol-error':
      return 'protocol';
    case 'backend-worker-crash':
    case 'unknown-agent-failure':
      return 'runtime';
  }
}
