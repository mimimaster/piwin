import type { MobileAttentionCatchUpItem } from './mobile-attention-controller.js';

let draft: readonly MobileAttentionCatchUpItem[] = [];

export function setMobileCatchUpDraft(items: readonly MobileAttentionCatchUpItem[]): void {
  draft = items;
}

export function getMobileCatchUpDraft(): readonly MobileAttentionCatchUpItem[] {
  return draft;
}

export function clearMobileCatchUpDraft(): void {
  draft = [];
}
