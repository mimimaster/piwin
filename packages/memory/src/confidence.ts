import type { MemoryConfidence } from '@piwin/contracts';
import { HIGH_CONFIDENCE_MIN_QUOTE_LENGTH } from './constants.js';

/**
 * High confidence requires quote length >= 5 or explicit review.
 * Otherwise downgrade high → medium. Other levels pass through.
 */
export function applyConfidencePolicy(input: {
  confidence: MemoryConfidence;
  quote?: string;
  reviewedAt?: string;
}): MemoryConfidence {
  if (input.confidence !== 'high') {
    return input.confidence;
  }
  if (input.reviewedAt && input.reviewedAt.trim().length > 0) {
    return 'high';
  }
  const quoteLength = (input.quote ?? '').trim().length;
  if (quoteLength >= HIGH_CONFIDENCE_MIN_QUOTE_LENGTH) {
    return 'high';
  }
  return 'medium';
}

export function parseConfidence(value: unknown): MemoryConfidence {
  if (value === 'high' || value === 'medium' || value === 'low' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}
