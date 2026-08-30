import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from './config.js';
import type { SessionContextSnapshot } from './context-telemetry.js';
import type { ContextUsageSnapshot } from './usage.js';

/** Keep migration below the hard provider limit so the next turn has working room. */
export const MODEL_SWITCH_CONTEXT_SOFT_LIMIT_RATIO = 0.8;

export type ModelContextBudgetInput = {
  contextWindow?: number;
  maxOutputTokens?: number;
};

export type ModelContextBudget = {
  contextWindow: number;
  outputReserve: number;
  safetyReserve: number;
  inputBudget: number;
};

/**
 * Resolve a conservative target-model input budget shared by Host and shells.
 * Host remains authoritative because it resolves the model values from config.
 */
export function resolveModelContextBudget(input: ModelContextBudgetInput): ModelContextBudget {
  const contextWindow = positiveInteger(input.contextWindow, DEFAULT_MODEL_CONTEXT_WINDOW);
  const outputReserve = Math.min(
    contextWindow - 1,
    positiveInteger(input.maxOutputTokens, DEFAULT_MODEL_MAX_OUTPUT_TOKENS),
  );
  const safetyReserve = Math.max(4_096, Math.ceil(contextWindow * 0.05));
  const hardInputBudget = Math.max(1, contextWindow - outputReserve - safetyReserve);
  const softInputBudget = Math.max(
    1,
    Math.floor(contextWindow * MODEL_SWITCH_CONTEXT_SOFT_LIMIT_RATIO),
  );
  return {
    contextWindow,
    outputReserve,
    safetyReserve,
    inputBudget: Math.min(hardInputBudget, softInputBudget),
  };
}

/**
 * Prefer Host snapshot occupancy (cache + output already included when known).
 * Unknown occupancy is not 0. Legacy ContextUsageSnapshot keeps prior fallbacks.
 */
export function readContextOccupiedTokens(
  usage: ContextUsageSnapshot | SessionContextSnapshot | null | undefined,
): number | undefined {
  if (!usage) {
    return undefined;
  }
  if ('occupancy' in usage) {
    if (usage.occupancy.kind !== 'known') {
      return undefined;
    }
    return Math.ceil(usage.occupancy.tokensUsed);
  }
  const ratioEstimate =
    typeof usage.contextRatio === 'number' &&
    Number.isFinite(usage.contextRatio) &&
    typeof usage.tokensLimit === 'number' &&
    Number.isFinite(usage.tokensLimit)
      ? usage.contextRatio * usage.tokensLimit
      : undefined;
  const value = usage.tokensUsed ?? usage.promptTokens ?? usage.totalTokens ?? ratioEstimate;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.ceil(value)
    : undefined;
}

/** Conservative fallback for the not-yet-sent user turn and structured refs. */
export function estimatePendingPromptTokens(input: {
  text: string;
  attachmentCount?: number;
  contextRefCount?: number;
}): number {
  const textTokens = Math.ceil(input.text.length / 4);
  const attachmentTokens = positiveCount(input.attachmentCount) * 1_024;
  const contextRefTokens = positiveCount(input.contextRefCount) * 1_024;
  return textTokens + attachmentTokens + contextRefTokens;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
