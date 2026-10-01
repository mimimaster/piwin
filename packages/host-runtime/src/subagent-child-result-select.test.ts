import { describe, expect, it } from 'vitest';

import { selectChildResult } from './subagent-child-result-select.js';

const entry = (runId: string, taskId = 't1') => ({ manifest: { runId }, task: { id: taskId } });

describe('selectChildResult', () => {
  const newestFirst = [entry('run-3'), entry('run-2'), entry('run-1')];

  it('means the newest result when no target is given', () => {
    const picked = selectChildResult(newestFirst);

    expect(picked.entry).toBe(newestFirst[0]);
    expect(picked.isLatest).toBe(true);
  });

  it('reaches an older result of the same child when it is targeted', () => {
    const picked = selectChildResult(newestFirst, { runId: 'run-1', taskId: 't1' });

    expect(picked.entry).toBe(newestFirst[2]);
    expect(picked.isLatest).toBe(false);
  });

  it('reports the newest result as latest when it is targeted explicitly', () => {
    expect(selectChildResult(newestFirst, { runId: 'run-3', taskId: 't1' }).isLatest).toBe(true);
  });

  it('finds nothing for an unknown target or an empty list', () => {
    expect(selectChildResult(newestFirst, { runId: 'run-9', taskId: 't1' })).toEqual({
      entry: undefined,
      isLatest: false,
    });
    expect(selectChildResult([])).toEqual({ entry: undefined, isLatest: false });
  });

  it('distinguishes tasks within one run', () => {
    const entries = [entry('run-1', 'b'), entry('run-1', 'a')];

    expect(selectChildResult(entries, { runId: 'run-1', taskId: 'a' }).entry).toBe(entries[1]);
  });
});
