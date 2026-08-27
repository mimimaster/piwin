import type { AgentMessageRole } from '@piwin/contracts';

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readRole(value: unknown): AgentMessageRole | undefined {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') {
    return value;
  }
  // Pi names tool-result lifecycle messages `toolResult`. They are transport
  // artifacts, not additional Assistant/model responses.
  if (value === 'toolResult' || value === 'tool_result') {
    return 'tool';
  }
  return undefined;
}

export function readNestedId(event: Record<string, unknown>, key: string): string | undefined {
  const nested = asRecord(event[key]);
  return nested ? readString(nested.id) : undefined;
}

export function readNestedRole(
  event: Record<string, unknown>,
  key: string,
): AgentMessageRole | undefined {
  const nested = asRecord(event[key]);
  return nested ? readRole(nested.role) : undefined;
}

/**
 * Pull a human-readable upstream provider/Pi error string from common shapes:
 * plain strings, `{ errorMessage }`, `{ error: string | { message } }`, etc.
 * Returns undefined when nothing usable is present (caller chooses fallback).
 */
export function readUpstreamErrorMessage(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (trimmed.length > 0) return trimmed;
      continue;
    }
    const record = asRecord(source);
    if (!record) continue;
    for (const key of ['errorMessage', 'message', 'error', 'detail', 'details'] as const) {
      const value = record[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
        continue;
      }
      const nested = asRecord(value);
      if (!nested) continue;
      const nestedMessage =
        readString(nested.message) ??
        readString(nested.errorMessage) ??
        readString(nested.error) ??
        readString(nested.detail);
      if (nestedMessage && nestedMessage.trim().length > 0) {
        return nestedMessage.trim();
      }
    }
  }
  return undefined;
}
