import { describe, it, expect } from 'vitest';
import { parseSubagentRunIds } from './subagent-tool-input.js';

describe('parseSubagentRunIds', () => {
  it('deduplicates while preserving caller order', () => {
    const result = parseSubagentRunIds({
      runIds: [' run-a ', 'run-b', 'run-a', ' run-b '],
    });
    expect(result).toEqual({ ok: true, value: ['run-a', 'run-b'] });
  });

  it('accepts between 1 and 8 unique ids', () => {
    const eight = Array.from({ length: 8 }, (_, index) => `run-${index}`);
    expect(parseSubagentRunIds({ runIds: ['run-1'] })).toEqual({
      ok: true,
      value: ['run-1'],
    });
    expect(parseSubagentRunIds({ runIds: eight })).toEqual({
      ok: true,
      value: eight,
    });
  });

  it('rejects empty arrays after dedupe', () => {
    expect(parseSubagentRunIds({ runIds: [] })).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
  });

  it('rejects more than 8 unique ids', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `run-${index}`);
    expect(parseSubagentRunIds({ runIds: nine })).toMatchObject({
      ok: false,
      code: 'invalid-input',
      message: 'runIds must contain at most 8 ids',
    });
  });

  it('rejects missing, non-array, and non-string entries', () => {
    expect(parseSubagentRunIds({})).toMatchObject({
      ok: false,
      code: 'invalid-input',
      message: 'runIds must be an array of strings',
    });
    expect(parseSubagentRunIds({ runIds: 'run-1' })).toMatchObject({
      ok: false,
      code: 'invalid-input',
      message: 'runIds must be an array of strings',
    });
    expect(parseSubagentRunIds({ runIds: ['run-1', 2] })).toMatchObject({
      ok: false,
      code: 'invalid-input',
      message: 'runIds must be an array of strings',
    });
  });
});
