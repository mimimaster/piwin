/**
 * Normalize Codex Live client-delegation wire events into product events.
 * Keep chatgpt.com field names inside this module only.
 */

import { LIVE_DELEGATION_INSTRUCTION_MAX_BYTES, type LiveCallErrorCode } from '@piwin/contracts';
import type { VoiceDelegationEvent } from './realtime-voice-adapter.js';

export function normalizeCodexDelegationCreated(value: unknown): VoiceDelegationEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'delegation.created') return null;
  const item = event.item;
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (record.type !== 'delegation' || record.target !== 'client') return null;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (!Array.isArray(record.content)) return null;

  const instruction = record.content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const entry = part as Record<string, unknown>;
      if (entry.type === 'input_text' && typeof entry.text === 'string') return [entry.text];
      return [];
    })
    .join('')
    .trim();

  if (!instruction) return null;
  if (new TextEncoder().encode(instruction).byteLength > LIVE_DELEGATION_INSTRUCTION_MAX_BYTES) {
    return null;
  }

  return {
    providerDelegationId: record.id.trim(),
    instruction,
  };
}

export function mapHttpStatusToLiveError(status: number): LiveCallErrorCode {
  if (status === 401) return 'live-provider-auth';
  if (status === 403) return 'live-provider-access-denied';
  if (status === 429) return 'live-provider-rejected';
  if (status >= 400 && status < 500) return 'live-protocol-failed';
  return 'live-protocol-failed';
}

export function mapCaughtToLiveError(error: unknown): LiveCallErrorCode {
  if (error instanceof DOMException && error.name === 'AbortError') return 'live-protocol-failed';
  if (error instanceof Error) {
    if (/401|unauthorized|token/i.test(error.message)) return 'live-provider-auth';
    if (/429|rate/i.test(error.message)) return 'live-provider-rejected';
  }
  return 'live-protocol-failed';
}
