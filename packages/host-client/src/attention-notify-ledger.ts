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
  const entry = ledger.entries.find((item) => item.key === key);
  if (!entry) {
    return false;
  }
  return now - entry.at < ATTENTION_LEDGER_TTL_MS;
}

export function recordAttentionNotified(
  ledger: AttentionNotifyLedger,
  key: string,
  now: number,
): AttentionNotifyLedger {
  const entries: Array<{ key: string; at: number }> = [];
  for (const entry of ledger.entries) {
    if (entry.key === key) {
      continue;
    }
    if (now - entry.at >= ATTENTION_LEDGER_TTL_MS) {
      continue;
    }
    entries.push(entry);
  }
  entries.push({ key, at: now });
  if (entries.length > ATTENTION_LEDGER_MAX_ENTRIES) {
    entries.splice(0, entries.length - ATTENTION_LEDGER_MAX_ENTRIES);
  }
  return { entries };
}

export function readAttentionNotifyLedger(raw: unknown): AttentionNotifyLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return EMPTY_ATTENTION_LEDGER;
  }
  if (!('entries' in raw) || !Array.isArray(raw.entries)) {
    return EMPTY_ATTENTION_LEDGER;
  }
  const entries: Array<{ key: string; at: number }> = [];
  for (const item of raw.entries) {
    const parsed = parseLedgerEntry(item);
    if (!parsed) {
      return EMPTY_ATTENTION_LEDGER;
    }
    entries.push(parsed);
  }
  return entries.length === 0 ? EMPTY_ATTENTION_LEDGER : { entries };
}

export type AttentionBurstWindow = { deliveredAt: readonly number[] };

export const EMPTY_ATTENTION_BURST_WINDOW: AttentionBurstWindow = { deliveredAt: [] };

export function admitAttentionBanner(
  window: AttentionBurstWindow,
  now: number,
): { window: AttentionBurstWindow; mode: 'single' | 'summary' } {
  const deliveredAt = window.deliveredAt.filter((at) => now - at < ATTENTION_BURST_WINDOW_MS);
  const mode = deliveredAt.length >= ATTENTION_BURST_MAX_SINGLE ? 'summary' : 'single';
  deliveredAt.push(now);
  return { window: { deliveredAt }, mode };
}

function parseLedgerEntry(raw: unknown): { key: string; at: number } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  if (!('key' in raw) || !('at' in raw)) {
    return null;
  }
  if (typeof raw.key !== 'string' || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) {
    return null;
  }
  return { key: raw.key, at: raw.at };
}
