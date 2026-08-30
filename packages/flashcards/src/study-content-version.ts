import { createHash } from 'node:crypto';
import type { FlashcardItem, FlashcardReviewCard } from '@piwin/contracts';

export function digestUtf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestIdempotencyKey(idempotencyKey: string): string {
  return digestUtf8(idempotencyKey);
}

export function digestPayload(payload: unknown): string {
  return digestUtf8(stableStringify(payload));
}

export function computeItemContentVersion(item: FlashcardItem): string {
  if (item.model === 'cloze') {
    return digestUtf8(`cloze\0${item.text ?? ''}`);
  }
  return digestUtf8(`basic\0${item.front ?? ''}\0${item.back ?? ''}`);
}

export function computeReviewCardContentVersion(card: FlashcardReviewCard): string {
  return digestUtf8(`${card.model}\0${card.ordinal}\0${card.front}\0${card.back}`);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function scopesEqual(
  left: { kind: string; [key: string]: unknown },
  right: { kind: string; [key: string]: unknown },
): boolean {
  return stableStringify(left) === stableStringify(right);
}
