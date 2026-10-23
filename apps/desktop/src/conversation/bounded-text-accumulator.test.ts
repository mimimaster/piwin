import { describe, expect, it } from 'vitest';
import {
  appendBoundedText,
  createBoundedTextAccumulator,
  type BoundedTextAccumulatorOptions,
} from './bounded-text-accumulator';

const OPTIONS: BoundedTextAccumulatorOptions = {
  maximumBytes: 256 * 1024,
  truncationMarker: '\n[output truncated: retention limit reached]',
};

describe('bounded text accumulator', () => {
  it('accounts for many small deltas without exceeding the UTF-8 cap', () => {
    let accumulator = createBoundedTextAccumulator('', OPTIONS);
    for (let index = 0; index < 20_000; index += 1) {
      accumulator = appendBoundedText(accumulator, '0123456789abcdef', OPTIONS);
    }

    expect(accumulator.truncated).toBe(true);
    expect(accumulator.retainedBytes).toBeLessThanOrEqual(OPTIONS.maximumBytes);
    expect(new TextEncoder().encode(accumulator.text).byteLength).toBe(accumulator.retainedBytes);
    expect(accumulator.text.endsWith(OPTIONS.truncationMarker)).toBe(true);
  });

  it('keeps Unicode boundaries exact when the final code point crosses the cap', () => {
    const options = { maximumBytes: 14, truncationMarker: '[cut]' };
    const accumulator = appendBoundedText(
      createBoundedTextAccumulator('123456789', options),
      '中文',
      options,
    );

    expect(accumulator.text).toBe('123456789[cut]');
    expect(accumulator.retainedBytes).toBe(14);
    expect(new TextEncoder().encode(accumulator.text).byteLength).toBe(14);
  });

  it('bounds a single 10 MiB burst and makes later appends no-ops', () => {
    const initial = createBoundedTextAccumulator('', OPTIONS);
    const bounded = appendBoundedText(initial, 'x'.repeat(10 * 1024 * 1024), OPTIONS);
    const afterTerminalNoise = appendBoundedText(bounded, 'ignored', OPTIONS);

    expect(bounded.truncated).toBe(true);
    expect(bounded.retainedBytes).toBe(OPTIONS.maximumBytes);
    expect(afterTerminalNoise).toBe(bounded);
  });
});
