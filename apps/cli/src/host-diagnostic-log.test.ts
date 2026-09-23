import { describe, expect, it } from 'vitest';
import { stampLines } from './host-diagnostic-log.js';

describe('stampLines', () => {
  const ts = '2026-09-23T00:00:00.000Z';

  it('stamps every line that starts inside the chunk', () => {
    expect(stampLines('a\nb\n', true, ts)).toBe(`[${ts}] a\n[${ts}] b\n`);
  });

  it('continues a partial line without a second stamp', () => {
    expect(stampLines('tail\nnext', false, ts)).toBe(`tail\n[${ts}] next`);
  });
});
