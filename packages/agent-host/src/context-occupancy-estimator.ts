/**
 * Pure occupancy math. No Pi types, no I/O.
 *
 * tokensUsed is window fill (input + output + cache once), never billable
 * input-only and never a fake 0 when nothing was observed.
 */
import type { ContextOccupancy } from '@piwin/contracts';

export type OccupancyRequestUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  /** Default true when totalTokens is set: Pi/provider total already includes cache. */
  cacheIncludedInTotal?: boolean;
  stopReason?: string;
};

export type OccupancyTrailingTokens = {
  userTokens?: number;
  toolResultTokens?: number;
  steerTokens?: number;
  streamingOutputTokens?: number;
  /** Trailing content already inside the next request's measured input. */
  includedInMeasuredInput?: boolean;
  unobserved?: boolean;
};

export type OccupancyObservedContext = {
  systemPromptTokens?: number;
  toolDefinitionTokens?: number;
  messageTokens?: number;
  imageTokens?: number;
  attachmentTokens?: number;
  missingImageEstimate?: boolean;
  missingAttachmentEstimate?: boolean;
  unobserved?: boolean;
};

export type EstimateContextOccupancyInput = {
  sampledAt: string;
  tokensLimit?: number;
  currentRequest?: OccupancyRequestUsage;
  lastCompletedRequest?: OccupancyRequestUsage;
  trailing?: OccupancyTrailingTokens;
  observedContext?: OccupancyObservedContext;
  /** Model change / compaction / rebuild: ignore lastCompletedRequest. */
  baselineInvalidated?: boolean;
};

export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) {
    return 0;
  }
  return Math.ceil(chars / 4);
}

export function windowFillTokens(usage: OccupancyRequestUsage): number | undefined {
  const cache = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (usage.totalTokens !== undefined) {
    if (usage.totalTokens > 0) {
      if (usage.cacheIncludedInTotal === false) {
        return usage.totalTokens + cache;
      }
      return usage.totalTokens;
    }
    if (usage.totalTokens === 0 && usage.inputTokens === undefined && usage.outputTokens === undefined) {
      return 0;
    }
  }
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.cacheReadTokens === undefined &&
    usage.cacheWriteTokens === undefined &&
    usage.totalTokens === undefined
  ) {
    return undefined;
  }
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + cache;
}

export function isValidOccupancyBaseline(usage: OccupancyRequestUsage | undefined): boolean {
  if (!usage) {
    return false;
  }
  if (usage.stopReason === 'aborted' || usage.stopReason === 'error') {
    return false;
  }
  const tokens = windowFillTokens(usage);
  return tokens !== undefined && tokens > 0;
}

export function estimateContextOccupancy(input: EstimateContextOccupancyInput): ContextOccupancy {
  const current = input.currentRequest;
  if (current && (current.stopReason === 'aborted' || current.stopReason === 'error')) {
    return { kind: 'unknown', reason: 'error-or-aborted-usage' };
  }
  if (current && isAllZeroUsage(current)) {
    return { kind: 'unknown', reason: 'invalid-zero-usage' };
  }

  if (isValidOccupancyBaseline(current)) {
    if (current === undefined) {
      return { kind: 'unknown', reason: 'no-measurement' };
    }
    const tokens = windowFillTokens(current);
    if (tokens === undefined || tokens <= 0) {
      return { kind: 'unknown', reason: 'invalid-zero-usage' };
    }
    const outputMeasured = current.outputTokens !== undefined;
    const inputMeasured =
      current.inputTokens !== undefined || current.totalTokens !== undefined;
    const trailingUnobserved = input.trailing?.unobserved === true;
    const observedGap = hasObservedGap(input.observedContext);
    return knownOccupancy({
      tokensUsed: tokens,
      sampledAt: input.sampledAt,
      quality: outputMeasured && inputMeasured ? 'measured' : 'estimated',
      coverage: trailingUnobserved || observedGap ? 'partial' : 'complete',
      basis: 'current-request',
      ...optionalLimit(input.tokensLimit),
    });
  }

  const lastCompleted = input.baselineInvalidated ? undefined : input.lastCompletedRequest;
  if (isValidOccupancyBaseline(lastCompleted) && lastCompleted) {
    const baseline = windowFillTokens(lastCompleted);
    if (baseline === undefined) {
      return { kind: 'unknown', reason: 'no-measurement' };
    }
    const trailing = trailingTokens(input.trailing);
    const unobserved = input.trailing?.unobserved === true || hasObservedGap(input.observedContext);
    return knownOccupancy({
      tokensUsed: baseline + trailing,
      sampledAt: input.sampledAt,
      quality: 'estimated',
      coverage: unobserved ? 'partial' : 'complete',
      basis: 'last-request+trailing',
      ...optionalLimit(input.tokensLimit),
    });
  }

  if (input.trailing?.unobserved === true && !hasObservedContext(input.observedContext)) {
    return { kind: 'unknown', reason: 'unobserved-context' };
  }

  if (hasObservedContext(input.observedContext) && input.observedContext) {
    const tokens = observedContextTokens(input.observedContext);
    if (tokens <= 0) {
      return { kind: 'unknown', reason: 'no-measurement' };
    }
    const gap =
      input.observedContext.unobserved === true ||
      input.observedContext.missingImageEstimate === true ||
      input.observedContext.missingAttachmentEstimate === true;
    return knownOccupancy({
      tokensUsed: tokens,
      sampledAt: input.sampledAt,
      quality: 'estimated',
      coverage: gap ? 'partial' : 'complete',
      basis: 'observed-context',
      ...optionalLimit(input.tokensLimit),
    });
  }

  return { kind: 'unknown', reason: 'no-measurement' };
}

function isAllZeroUsage(usage: OccupancyRequestUsage): boolean {
  const tokens = windowFillTokens(usage);
  return tokens === 0;
}

function trailingTokens(trailing: OccupancyTrailingTokens | undefined): number {
  if (!trailing) {
    return 0;
  }
  const streaming = trailing.streamingOutputTokens ?? 0;
  if (trailing.includedInMeasuredInput) {
    return streaming;
  }
  return (
    (trailing.userTokens ?? 0) +
    (trailing.toolResultTokens ?? 0) +
    (trailing.steerTokens ?? 0) +
    streaming
  );
}

function hasObservedContext(observed: OccupancyObservedContext | undefined): boolean {
  if (!observed) {
    return false;
  }
  return (
    observed.systemPromptTokens !== undefined ||
    observed.toolDefinitionTokens !== undefined ||
    observed.messageTokens !== undefined ||
    observed.imageTokens !== undefined ||
    observed.attachmentTokens !== undefined
  );
}

function hasObservedGap(observed: OccupancyObservedContext | undefined): boolean {
  return (
    observed?.unobserved === true ||
    observed?.missingImageEstimate === true ||
    observed?.missingAttachmentEstimate === true
  );
}

function observedContextTokens(observed: OccupancyObservedContext): number {
  return (
    (observed.systemPromptTokens ?? 0) +
    (observed.toolDefinitionTokens ?? 0) +
    (observed.messageTokens ?? 0) +
    (observed.imageTokens ?? 0) +
    (observed.attachmentTokens ?? 0)
  );
}

function optionalLimit(tokensLimit: number | undefined): { tokensLimit?: number } {
  return tokensLimit !== undefined ? { tokensLimit } : {};
}

function knownOccupancy(input: {
  tokensUsed: number;
  sampledAt: string;
  tokensLimit?: number;
  quality: 'measured' | 'estimated';
  coverage: 'complete' | 'partial';
  basis: string;
}): Extract<ContextOccupancy, { kind: 'known' }> {
  const occupancy: Extract<ContextOccupancy, { kind: 'known' }> = {
    kind: 'known',
    tokensUsed: input.tokensUsed,
    quality: input.quality,
    coverage: input.coverage,
    basis: input.basis,
    sampledAt: input.sampledAt,
  };
  if (input.tokensLimit !== undefined) {
    occupancy.tokensLimit = input.tokensLimit;
  }
  return occupancy;
}
