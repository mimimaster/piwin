import { describe, expect, it } from 'vitest';
import { formatElapsed } from './status-line.js';

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12_400)).toBe('12s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(3_725_000)).toBe('1h 02m');
    expect(formatElapsed(-5)).toBe('0s');
  });
});
