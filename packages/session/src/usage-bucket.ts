/**
 * Token usage accumulation shared by the global usage ledger rollup and the
 * per-session totals, so both count requests, cache tokens and tok/s the same.
 */
import type { UsageBucket } from '@piwin/contracts';

/** One finalized request's usage, as recorded by the ledger or a session store. */
export type UsageBucketSample = {
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  durationMs?: number;
  firstTokenMs?: number;
  /** Omitted counts as success. */
  success?: boolean;
};

export function createUsageBucket(): UsageBucket {
  return {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    entryCount: 0,
  };
}

export function addToUsageBucket(
  bucket: UsageBucket,
  sample: UsageBucketSample,
  estimatedCostUsd?: number,
): void {
  if (estimatedCostUsd !== undefined && Number.isFinite(estimatedCostUsd) && estimatedCostUsd >= 0) {
    bucket.estimatedCostUsd = (bucket.estimatedCostUsd ?? 0) + estimatedCostUsd;
    bucket.pricedEntryCount = (bucket.pricedEntryCount ?? 0) + 1;
  }
  bucket.promptTokens += sample.promptTokens ?? 0;
  bucket.completionTokens += sample.completionTokens ?? 0;
  bucket.cacheReadTokens += sample.cacheReadTokens ?? 0;
  bucket.cacheWriteTokens += sample.cacheWriteTokens ?? 0;
  bucket.totalTokens += sample.totalTokens;
  bucket.entryCount += 1;
  if (typeof sample.durationMs === 'number' && Number.isFinite(sample.durationMs)) {
    bucket.durationMs = (bucket.durationMs ?? 0) + sample.durationMs;
    // Only tokens with a matching duration feed tok/s, so partial data stays honest.
    bucket.durationMsCompletionTokens =
      (bucket.durationMsCompletionTokens ?? 0) + (sample.completionTokens ?? 0);
  }
  if (typeof sample.firstTokenMs === 'number' && Number.isFinite(sample.firstTokenMs)) {
    const prevCount = bucket.firstTokenMs !== undefined ? bucket.entryCount - 1 : 0;
    const prevSum = (bucket.firstTokenMs ?? 0) * prevCount;
    bucket.firstTokenMs = (prevSum + sample.firstTokenMs) / bucket.entryCount;
  }
  if (sample.success !== false) {
    bucket.successCount = (bucket.successCount ?? 0) + 1;
  }
}
