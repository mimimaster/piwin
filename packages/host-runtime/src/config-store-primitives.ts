import type { SubagentProfileSettings, ThinkingLevel } from '@piwin/contracts';

/**
 * Value guards and the ModelRef normalizer shared by every config domain module.
 */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function asPositiveInteger(value: unknown): number | undefined {
  const numericValue = asPositiveNumber(value);
  return numericValue === undefined ? undefined : Math.floor(numericValue);
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  // Preserve empty arrays (e.g. disabledIds: []) so defaults are not re-applied.
  return value.filter((item): item is string => typeof item === 'string');
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max' ||
    value === 'ultra'
  );
}

export function isModelProtocol(
  value: unknown,
): value is 'openai-compatible' | 'anthropic-compatible' | 'google-gemini' {
  return (
    value === 'openai-compatible' || value === 'anthropic-compatible' || value === 'google-gemini'
  );
}

export function normalizeModelRef(value: unknown): SubagentProfileSettings['model'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const protocol = record.protocol;
  if (
    protocol !== 'openai-compatible' &&
    protocol !== 'anthropic-compatible' &&
    protocol !== 'google-gemini'
  ) {
    return undefined;
  }
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
  if (!providerId || !modelId) return undefined;
  return { protocol, providerId, modelId };
}
