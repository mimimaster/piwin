import { describe, expect, it } from 'vitest';
import {
  ATTENTION_BURST_WINDOW_MS,
  ATTENTION_LEDGER_MAX_ENTRIES,
  ATTENTION_LEDGER_TTL_MS,
  EMPTY_ATTENTION_BURST_WINDOW,
  EMPTY_ATTENTION_LEDGER,
  admitAttentionBanner,
  hasAttentionNotified,
  readAttentionNotifyLedger,
  recordAttentionNotified,
} from './attention-notify-ledger.js';

describe('attention-notify-ledger', () => {
  it('T20: 记录后命中；24h 后不命中', () => {
    const now = 1_700_000_000_000;
    const ledger = recordAttentionNotified(EMPTY_ATTENTION_LEDGER, 'run:1', now);
    expect(hasAttentionNotified(ledger, 'run:1', now)).toBe(true);
    expect(hasAttentionNotified(ledger, 'run:1', now + ATTENTION_LEDGER_TTL_MS - 1)).toBe(true);
    expect(hasAttentionNotified(ledger, 'run:1', now + ATTENTION_LEDGER_TTL_MS)).toBe(false);
    expect(hasAttentionNotified(ledger, 'run:other', now)).toBe(false);
  });

  it('T21: 第 257 条淘汰最旧；重复 key 更新时间不重复占位', () => {
    const t0 = 1_000;
    let ledger = EMPTY_ATTENTION_LEDGER;
    for (let i = 0; i < ATTENTION_LEDGER_MAX_ENTRIES; i += 1) {
      ledger = recordAttentionNotified(ledger, `k${i}`, t0 + i);
    }
    expect(ledger.entries).toHaveLength(ATTENTION_LEDGER_MAX_ENTRIES);
    expect(hasAttentionNotified(ledger, 'k0', t0 + ATTENTION_LEDGER_MAX_ENTRIES - 1)).toBe(true);

    ledger = recordAttentionNotified(ledger, 'k0', t0 + 10_000);
    expect(ledger.entries).toHaveLength(ATTENTION_LEDGER_MAX_ENTRIES);
    expect(ledger.entries.filter((entry) => entry.key === 'k0')).toEqual([
      { key: 'k0', at: t0 + 10_000 },
    ]);

    ledger = recordAttentionNotified(ledger, 'k256', t0 + 10_001);
    expect(ledger.entries).toHaveLength(ATTENTION_LEDGER_MAX_ENTRIES);
    expect(hasAttentionNotified(ledger, 'k0', t0 + 10_001)).toBe(true);
    expect(hasAttentionNotified(ledger, 'k1', t0 + 10_001)).toBe(false);
    expect(hasAttentionNotified(ledger, 'k256', t0 + 10_001)).toBe(true);
  });

  it('T22: 非法 raw（null、错类型、缺字段）→ 空账本', () => {
    expect(readAttentionNotifyLedger(null)).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger(undefined)).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger(1)).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger('ledger')).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger([])).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger({})).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger({ entries: null })).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger({ entries: [{ key: 'a' }] })).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger({ entries: [{ at: 1 }] })).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger({ entries: [{ key: 1, at: 1 }] })).toBe(EMPTY_ATTENTION_LEDGER);
    expect(readAttentionNotifyLedger({ entries: [{ key: 'a', at: Number.NaN }] })).toBe(
      EMPTY_ATTENTION_LEDGER,
    );
    expect(readAttentionNotifyLedger({ entries: [{ key: 'a', at: 1 }] })).toEqual({
      entries: [{ key: 'a', at: 1 }],
    });
  });

  it('T23: 60s 内第 4 次 → summary；第 1 次滑出窗口后 → single', () => {
    let burst = EMPTY_ATTENTION_BURST_WINDOW;
    const t0 = 10_000;
    const modes: Array<'single' | 'summary'> = [];
    for (let i = 0; i < 4; i += 1) {
      const admitted = admitAttentionBanner(burst, t0);
      burst = admitted.window;
      modes.push(admitted.mode);
    }
    expect(modes).toEqual(['single', 'single', 'single', 'summary']);

    const afterSlide = admitAttentionBanner(burst, t0 + ATTENTION_BURST_WINDOW_MS);
    expect(afterSlide.mode).toBe('single');
  });
});
