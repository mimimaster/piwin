import type { AttentionPreferences } from '@piwin/host-client';

export const ATTENTION_PREFERENCES_KEY = 'piwin.desktop.attention.v1';
export const ATTENTION_LEDGER_KEY = 'piwin.desktop.attention.ledger.v1';
export const ATTENTION_OPT_IN_DISMISSED_KEY = 'piwin.desktop.attention.optInDismissedAt';

export function readAttentionPreferences(
  storage?: Pick<Storage, 'getItem'>,
): AttentionPreferences {
  void storage;
  throw new Error('AN-U1 not implemented');
}

export function writeAttentionPreferences(
  next: AttentionPreferences,
  storage?: Pick<Storage, 'setItem'>,
): void {
  void next;
  void storage;
  throw new Error('AN-U1 not implemented');
}

export function subscribeAttentionPreferences(
  listener: (next: AttentionPreferences) => void,
): () => void {
  void listener;
  throw new Error('AN-U1 not implemented');
}
