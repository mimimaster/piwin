import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatSessionRelativeTime } from './session-relative-time';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatSessionRelativeTime', () => {
  it('formats compact session ages and rejects invalid or future timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));

    expect(formatSessionRelativeTime('2026-08-25T11:59:45.000Z')).toBe('now');
    expect(formatSessionRelativeTime('2026-08-25T09:00:00.000Z')).toBe('3h');
    expect(formatSessionRelativeTime('2026-08-20T12:00:00.000Z')).toBe('5d');
    expect(formatSessionRelativeTime('invalid')).toBe('');
    expect(formatSessionRelativeTime('2026-08-26T12:00:00.000Z')).toBe('');
  });
});
