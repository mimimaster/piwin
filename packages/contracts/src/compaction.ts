import {
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type CompactionConfig,
  type ModelProviderConfig,
} from './config.js';
import type { ModelRef } from './host.js';

/** The harmless no-op outcome reported by Pi's manual compaction API. */
export type CompactionNoOpKind = 'already-compacted' | 'too-small';

/** Resolved compaction delegation target compiled into a backend session blueprint. */
export type CompactionDelegationTarget = {
  model: ModelRef;
};

/**
 * Resolve active compaction delegation when enabled and backed by a complete ModelRef.
 */
export function resolveActiveCompactionDelegation(
  compaction: CompactionConfig | undefined,
): CompactionDelegationTarget | undefined {
  const delegation = compaction?.delegation;
  if (!delegation?.enabled || !delegation.model) {
    return undefined;
  }
  const providerId = delegation.model.providerId.trim();
  const modelId = delegation.model.modelId.trim();
  if (!providerId || !modelId) {
    return undefined;
  }
  return {
    model: {
      ...delegation.model,
      providerId,
      modelId,
    },
  };
}

/**
 * Resolve active compaction delegation only when it targets a currently enabled
 * provider and enabled chat-capable model.
 */
export function findReadyCompactionDelegate(input: {
  compaction?: CompactionConfig;
  providers: readonly ModelProviderConfig[];
}): ModelRef | undefined {
  const active = resolveActiveCompactionDelegation(input.compaction);
  if (!active) {
    return undefined;
  }
  const { model } = active;
  const provider = input.providers.find(
    (candidate) =>
      candidate.id === model.providerId &&
      candidate.protocol === model.protocol &&
      isProviderEnabled(candidate),
  );
  if (!provider) {
    return undefined;
  }
  const resolvedModel = provider.models.find(
    (candidate) =>
      candidate.id === model.modelId &&
      isModelEnabled(candidate) &&
      modelSupportsCapability(candidate, 'chat'),
  );
  if (!resolvedModel) {
    return undefined;
  }
  return model;
}

/**
 * A durable compaction boundary used when a Pi runtime is rebuilt.
 *
 * The summary is model-facing context, not a transcript message. Keeping it
 * separate lets a replacement runtime restore Pi's native compaction shape
 * without injecting a synthetic user-visible message into the product chat.
 */
export type SessionCompactionSeed = {
  summary: string;
  tokensBefore?: number;
};

/** Durable product-side record of one successful native compaction. */
export type SessionCompactionRecord = SessionCompactionSeed & {
  compactionId: string;
  sessionId: string;
  /** Product transcript leaf at the moment the compaction was committed. */
  anchorMessageId: string | null;
  /** Pi-native retained-entry boundary, when the adapter exposes it. */
  firstKeptEntryId?: string;
  tokensAfter?: number;
  runtimeGenerationId?: string;
  createdAt: string;
};

/** Input to a transcript store; the store supplies the owning session id. */
export type SessionCompactionRecordInput = Omit<SessionCompactionRecord, 'sessionId'>;

/** Stable context-boundary key shared by live events and durable replay. */
export function formatCompactionBoundary(input: {
  tokensBefore?: number;
  tokensAfter?: number;
}): string {
  return `compact:${input.tokensBefore ?? 'na'}:${input.tokensAfter ?? 'unknown'}`;
}

/**
 * Classify Pi's narrow no-op messages. Provider failures and malformed
 * results return undefined and must remain visible to callers.
 */
export function classifyCompactionNoOp(
  message: string | undefined,
): CompactionNoOpKind | undefined {
  const normalized = (message ?? '').toLowerCase();
  if (normalized.includes('already compacted')) return 'already-compacted';
  if (normalized.includes('nothing to compact') || normalized.includes('session too small')) {
    return 'too-small';
  }
  return undefined;
}
