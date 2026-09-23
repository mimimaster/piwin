import { describe, expect, it } from 'vitest';
import type { UsageBucket } from '@piwin/contracts';
import {
  buildUsageActivityCalendar,
  dayKeyIn,
  heatmapStart,
  levelOf,
  levelThresholds,
} from './usage-activity-calendar';

function bucket(totalTokens: number, entryCount = 1): UsageBucket {
  return {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: totalTokens,
    cacheWriteTokens: 0,
    totalTokens,
    entryCount,
  };
}

// Thursday 2026-09-24 in Shanghai (still the 23rd in UTC).
const NOW = new Date('2026-09-23T17:00:00Z');
const ZONE = 'Asia/Shanghai';

describe('calendar layout', () => {
  it('uses the viewer’s day and starts on a Monday', () => {
    expect(dayKeyIn(NOW, ZONE)).toBe('2026-09-24');
    expect(dayKeyIn(NOW)).toBe('2026-09-23');
    expect(heatmapStart('2026-09-24', 2)).toBe('2026-09-14');
  });

  it('lays days out Monday-first, blanks the rest of this week, and marks month starts', () => {
    const calendar = buildUsageActivityCalendar({}, 'tokens', { now: NOW, timeZone: ZONE, weeks: 3 });
    expect(calendar.weeks).toHaveLength(3);
    expect(calendar.weeks[0]?.[0]?.day).toBe('2026-09-07');
    const thisWeek = calendar.weeks[2] ?? [];
    expect(thisWeek.map((cell) => cell?.day ?? null)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      null,
      null,
      null,
    ]);
    expect(calendar.monthStarts).toEqual([]);
    const across = buildUsageActivityCalendar({}, 'tokens', { now: NOW, timeZone: ZONE, weeks: 5 });
    // Five weeks start Mon 2026-08-24; Tue 1 September falls in the second column.
    expect(across.monthStarts).toEqual([{ column: 1, month: '2026-09' }]);
  });
});

describe('levels', () => {
  it('splits active days into quartiles and keeps zero at level 0', () => {
    const thresholds = levelThresholds([0, 10, 20, 30, 40, 1000]);
    expect(thresholds).toEqual([20, 30, 40]);
    expect(levelOf(0, thresholds)).toBe(0);
    expect(levelOf(10, thresholds)).toBe(1);
    expect(levelOf(30, thresholds)).toBe(2);
    expect(levelOf(40, thresholds)).toBe(3);
    expect(levelOf(1000, thresholds)).toBe(4);
  });
});

describe('headline numbers', () => {
  const byDay = {
    '2026-09-20': bucket(100, 4),
    '2026-09-22': bucket(300, 2),
    '2026-09-23': bucket(200, 1),
  };

  it('reports today, average, peak, active days, and the streak', () => {
    const calendar = buildUsageActivityCalendar(byDay, 'tokens', { now: NOW, timeZone: ZONE, weeks: 2 });
    expect(calendar.today?.day).toBe('2026-09-24');
    expect(calendar.today?.value).toBe(0);
    expect(calendar.activeDays).toBe(3);
    expect(calendar.activeAverage).toBe(200);
    expect(calendar.peak?.day).toBe('2026-09-22');
    // Today is still empty, so the streak counts back from yesterday: 23rd, 22nd.
    expect(calendar.streak).toBe(2);
  });

  it('switches to request counts', () => {
    const calendar = buildUsageActivityCalendar(byDay, 'requests', { now: NOW, timeZone: ZONE, weeks: 2 });
    expect(calendar.peak?.day).toBe('2026-09-20');
  });
});
