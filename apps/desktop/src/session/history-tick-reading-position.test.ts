import { describe, expect, it } from 'vitest';
import { resolveReadingTickIndex } from './history-tick-reading-position.js';

describe('resolveReadingTickIndex', () => {
  it('picks the last anchor that passed the reading line', () => {
    expect(
      resolveReadingTickIndex(
        [
          { tickIndex: 3, top: -400 },
          { tickIndex: 4, top: 120 },
          { tickIndex: 5, top: 600 },
        ],
        200,
      ),
    ).toBe(4);
  });

  it('falls back to the turn before the first mounted anchor', () => {
    expect(
      resolveReadingTickIndex(
        [
          { tickIndex: 7, top: 500 },
          { tickIndex: 8, top: 900 },
        ],
        200,
      ),
    ).toBe(6);
  });

  it('clamps to the first tick at the top of the transcript', () => {
    expect(resolveReadingTickIndex([{ tickIndex: 0, top: 260 }], 200)).toBe(0);
  });

  it('keeps the previous value when no user anchor is mounted', () => {
    expect(resolveReadingTickIndex([], 200)).toBeNull();
  });
});
