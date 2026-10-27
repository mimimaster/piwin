import { describe, expect, it } from 'vitest';
import {
  MIN_TURN_SCROLL_THUMB_PCT,
  computeTurnScrollThumb,
  findTurnAnchor,
  isWholeSessionResident,
  resolveResidentTurnSpan,
  resolveTurnScrollTarget,
} from './transcript-turn-scale';

describe('resolveResidentTurnSpan', () => {
  it('places the live tail at the end of the session', () => {
    expect(
      resolveResidentTurnSpan({
        totalUserMessages: 500,
        residentUserMessages: 40,
        historyFirstOrdinal: undefined,
        historyViewActive: false,
      }),
    ).toEqual({ firstOrdinal: 460, count: 40, total: 500 });
  });

  it('places a history view by its Host page ordinal', () => {
    expect(
      resolveResidentTurnSpan({
        totalUserMessages: 500,
        residentUserMessages: 30,
        historyFirstOrdinal: 120,
        historyViewActive: true,
      }),
    ).toEqual({ firstOrdinal: 120, count: 30, total: 500 });
  });

  it('falls back to pixels without an index, a page ordinal, or turns', () => {
    const base = { residentUserMessages: 10, historyViewActive: false, historyFirstOrdinal: undefined };
    expect(resolveResidentTurnSpan({ ...base, totalUserMessages: null })).toBeNull();
    expect(resolveResidentTurnSpan({ ...base, totalUserMessages: 50, historyViewActive: true })).toBeNull();
    expect(resolveResidentTurnSpan({ ...base, totalUserMessages: 50, residentUserMessages: 0 })).toBeNull();
  });

  it('counts a just-sent turn the index has not caught up with', () => {
    const span = resolveResidentTurnSpan({
      totalUserMessages: 10,
      residentUserMessages: 11,
      historyFirstOrdinal: undefined,
      historyViewActive: false,
    });
    expect(span).toEqual({ firstOrdinal: 0, count: 11, total: 11 });
    expect(isWholeSessionResident(span)).toBe(true);
  });
});

describe('computeTurnScrollThumb', () => {
  it('matches the pixel scrollbar when every turn is resident', () => {
    expect(computeTurnScrollThumb({ span: null, scrollRatio: 0.25, scrollProgress: 0.5 })).toEqual({
      heightPct: 25,
      topPct: 37.5,
    });
  });

  it('puts the live tail bottom at the end and its top deep in the track', () => {
    const span = { firstOrdinal: 400, count: 100, total: 500 };
    const bottom = computeTurnScrollThumb({ span, scrollRatio: 0.1, scrollProgress: 1 });
    expect(bottom.heightPct).toBe(MIN_TURN_SCROLL_THUMB_PCT);
    expect(bottom.topPct).toBeCloseTo(100 - MIN_TURN_SCROLL_THUMB_PCT);
    const top = computeTurnScrollThumb({ span, scrollRatio: 0.1, scrollProgress: 0 });
    expect(top.topPct).toBeCloseTo(0.8 * (100 - MIN_TURN_SCROLL_THUMB_PCT));
  });
});

describe('resolveTurnScrollTarget', () => {
  const tail = { firstOrdinal: 400, count: 100, total: 500 };

  it('scrolls pixels inside the resident turns', () => {
    expect(resolveTurnScrollTarget({ span: tail, fraction: 0.9, maxScrollTop: 1000 })).toEqual({
      kind: 'pixels',
      scrollTop: 500,
    });
    expect(resolveTurnScrollTarget({ span: tail, fraction: 1, maxScrollTop: 1000 })).toEqual({
      kind: 'pixels',
      scrollTop: 1000,
    });
  });

  it('seeks a turn outside them', () => {
    expect(resolveTurnScrollTarget({ span: tail, fraction: 0.25, maxScrollTop: 1000 })).toEqual({
      kind: 'turn',
      ordinal: 125,
    });
    const history = { firstOrdinal: 100, count: 20, total: 500 };
    expect(resolveTurnScrollTarget({ span: history, fraction: 0.9, maxScrollTop: 1000 })).toEqual({
      kind: 'turn',
      ordinal: 450,
    });
  });

  it('stays in pixels when the whole session is resident', () => {
    expect(
      resolveTurnScrollTarget({
        span: { firstOrdinal: 0, count: 20, total: 20 },
        fraction: 0.5,
        maxScrollTop: 800,
      }),
    ).toEqual({ kind: 'pixels', scrollTop: 400 });
  });
});

describe('findTurnAnchor', () => {
  const anchors = [
    { id: 'a', ordinal: 0, spanStartOrdinal: 0, spanEndOrdinal: 9 },
    { id: 'b', ordinal: 10, spanStartOrdinal: 10, spanEndOrdinal: 19 },
    { id: 'c', ordinal: 40, spanStartOrdinal: 40, spanEndOrdinal: 40 },
  ];

  it('finds the span holding a turn, else the nearest anchor', () => {
    expect(findTurnAnchor(anchors, 14)?.id).toBe('b');
    expect(findTurnAnchor(anchors, 22)?.id).toBe('b');
    expect(findTurnAnchor(anchors, 35)?.id).toBe('c');
    expect(findTurnAnchor(anchors, 99)?.id).toBe('c');
    expect(findTurnAnchor([], 3)).toBeNull();
  });
});
