import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_FANOUT_ROW_HEIGHT,
  subagentFanoutCurvePath,
  subagentFanoutHeight,
  subagentFanoutOriginY,
  subagentFanoutRailPath,
  subagentFanoutRowY,
} from './subagent-fanout-geometry';

describe('subagent fan-out geometry', () => {
  it('sizes the body from the row count alone', () => {
    expect(subagentFanoutHeight(3)).toBe(3 * SUBAGENT_FANOUT_ROW_HEIGHT);
    expect(subagentFanoutHeight(-1)).toBe(0);
  });

  it('centres each row and the shared origin', () => {
    expect(subagentFanoutRowY(0)).toBe(SUBAGENT_FANOUT_ROW_HEIGHT / 2);
    expect(subagentFanoutRowY(2)).toBe(2.5 * SUBAGENT_FANOUT_ROW_HEIGHT);
    expect(subagentFanoutOriginY(3)).toBe(1.5 * SUBAGENT_FANOUT_ROW_HEIGHT);
  });

  it('runs every curve from the origin to its row edge', () => {
    const count = 3;
    const origin = subagentFanoutOriginY(count);
    for (let index = 0; index < count; index += 1) {
      const path = subagentFanoutCurvePath(index, count, 50);
      expect(path.startsWith(`M0 ${origin} `)).toBe(true);
      expect(path.endsWith(` 50 ${subagentFanoutRowY(index)}`)).toBe(true);
    }
  });

  it('keeps an earlier row wire fixed when a later row appends', () => {
    // Endpoints depend on the index only; the origin moves with the count.
    expect(subagentFanoutCurvePath(0, 2).endsWith(` ${subagentFanoutRowY(0)}`)).toBe(true);
    expect(subagentFanoutCurvePath(0, 3).endsWith(` ${subagentFanoutRowY(0)}`)).toBe(true);
  });

  it('elbows the rail into the row centre', () => {
    expect(subagentFanoutRailPath(1)).toBe(
      `M11 0 V${subagentFanoutRowY(1) - 6} Q11 ${subagentFanoutRowY(1)} 17 ${subagentFanoutRowY(1)} H22`,
    );
  });
});
