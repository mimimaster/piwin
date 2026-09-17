export const ATTENTION_LEDGER_MAX_ENTRIES = 256;
export const ATTENTION_LEDGER_TTL_MS = 86_400_000;
export const ATTENTION_BURST_WINDOW_MS = 60_000;
export const ATTENTION_BURST_MAX_SINGLE = 3;

export type AttentionNotifyLedger = {
  entries: ReadonlyArray<{ key: string; at: number }>;
};

export const EMPTY_ATTENTION_LEDGER: AttentionNotifyLedger = { entries: [] };

export function hasAttentionNotified(
  ledger: AttentionNotifyLedger,
  key: string,
  now: number,
): boolean {
  void ledger;
  void key;
  void now;
  throw new Error('AN-S3 not implemented');
}

export function recordAttentionNotified(
  ledger: AttentionNotifyLedger,
  key: string,
  now: number,
): AttentionNotifyLedger {
  void ledger;
  void key;
  void now;
  throw new Error('AN-S3 not implemented');
}

export function readAttentionNotifyLedger(raw: unknown): AttentionNotifyLedger {
  void raw;
  throw new Error('AN-S3 not implemented');
}

export type AttentionBurstWindow = { deliveredAt: readonly number[] };

export const EMPTY_ATTENTION_BURST_WINDOW: AttentionBurstWindow = { deliveredAt: [] };

export function admitAttentionBanner(
  window: AttentionBurstWindow,
  now: number,
): { window: AttentionBurstWindow; mode: 'single' | 'summary' } {
  void window;
  void now;
  throw new Error('AN-S3 not implemented');
}
