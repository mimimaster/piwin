/**
 * CE-SUB-PERSIST: bounded, redacted, durable failure projection.
 *
 * Task failures are persisted in run manifests and replayed to clients. Raw
 * exception text can contain authorization headers, API keys, absolute
 * home/worktree paths, and unbounded stderr. This module maps failures to
 * stable codes and keeps messages display-safe before they become durable.
 */

import type { SubagentFailure, SubagentFailureKind, SubagentFailurePhase } from '@piwin/contracts';

const MAX_FAILURE_MESSAGE_LENGTH = 512;

const API_KEY_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bsk-[A-Za-z0-9._-]{16,}\b/g,
  /\bapi[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
  /(authorization|proxy-authorization)["']?\s*[:=]\s*["']?[^\s"',;]{4,}["']?/gi,
  /x-api-key["']?\s*[:=]\s*["']?[^\s"',;]{4,}["']?/gi,
  /\b(?:token|access_token|refresh_token|password|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bauth_tokens\/[A-Za-z0-9._/-]{8,}/g,
  /\b(?:offerSdp|answerSdp|sdpOffer|sdpAnswer|ephemeralToken)\b["']?\s*[:=]\s*["']?[^\s"',]{8,}/gi,
];

const URL_QUERY_PATTERN = /([?&](?:key|token|api_key|apikey|access_token|auth)=)[^&\s"']+/gi;
const SDP_BLOB_PATTERN = /\bv=0\r?\n[\s\S]{0,800}/g;

/** Replace absolute product-owned paths with stable placeholders. */
function redactAbsolutePaths(message: string, rootDirs: readonly string[]): string {
  let redacted = message;
  for (const rootDir of rootDirs) {
    if (!rootDir) continue;
    const escaped = rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the root plus any trailing path fragment up to whitespace or
    // quotes. \x60 is the backtick, kept inside the character class safely.
    const trailingPathFragment = '[^\\s"\')\\]{}\\x60]*';
    redacted = redacted.replace(new RegExp(escaped + trailingPathFragment, 'g'), '<piwin-path>');
  }
  return redacted;
}

/**
 * Remove credentials, query secrets, and product-owned absolute paths from a
 * message, then bound its length. Credential patterns run first so a secret
 * adjacent to a path cannot survive intact.
 */
export function redactPersistedMessage(
  message: string,
  options?: { rootDirs?: readonly string[] },
): string {
  let redacted = message;
  for (const pattern of API_KEY_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const equalsIndex = match.indexOf('=');
      const colonIndex = match.indexOf(':');
      const separatorIndex = equalsIndex >= 0 ? equalsIndex : colonIndex;
      const prefix = separatorIndex >= 0 ? match.slice(0, separatorIndex + 1) : '';
      return `${prefix}<redacted>`;
    });
  }
  redacted = redacted.replace(URL_QUERY_PATTERN, '$1<redacted>');
  redacted = redacted.replace(SDP_BLOB_PATTERN, 'v=0\\n<redacted>');
  redacted = redacted.replace(/\s+/g, ' ').trim();
  redacted = redactAbsolutePaths(redacted, options?.rootDirs ?? []);
  if (redacted.length > MAX_FAILURE_MESSAGE_LENGTH) {
    redacted = `${redacted.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`;
  }
  return redacted;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'unknown subagent failure';
}

export type PersistedFailureContext = {
  kind: SubagentFailureKind;
  code: string;
  phase: SubagentFailurePhase;
  retryable: boolean;
  /** Product-owned roots whose absolute paths must not be persisted. */
  rootDirs?: readonly string[];
};

/**
 * Build a durable, display-safe failure from an arbitrary thrown value.
 * Never persists raw stderr or full command lines; only the bounded redacted
 * projection enters manifests.
 */
export function createPersistedFailure(
  error: unknown,
  context: PersistedFailureContext,
): SubagentFailure {
  return {
    kind: context.kind,
    code: context.code,
    phase: context.phase,
    retryable: context.retryable,
    message: redactPersistedMessage(messageFromUnknown(error), {
      ...(context.rootDirs ? { rootDirs: context.rootDirs } : {}),
    }),
  };
}

/** Interrupted-by-restart failure shared by recovery and terminalization. */
export const HOST_INTERRUPTED_FAILURE: SubagentFailure = {
  kind: 'host-interrupted',
  code: 'subagent-host-restarted',
  phase: 'execution',
  retryable: true,
  message: 'The Host stopped before this task completed.',
};
