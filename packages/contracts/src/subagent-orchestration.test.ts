import { describe, expect, it } from 'vitest';
import {
  validateSubagentBatchRequest,
  type SubagentBatchRequest,
  type SubagentTaskSpec,
} from './subagent-orchestration.js';

function makeTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    task: 'do something',
    ...overrides,
  };
}

function makeBatch(tasks: SubagentTaskSpec[], overrides: Partial<SubagentBatchRequest> = {}): SubagentBatchRequest {
  return {
    parentSessionId: 'parent-1',
    tasks,
    ...overrides,
  };
}

describe('validateSubagentBatchRequest', () => {
  it('accepts a valid batch with no dependencies', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]),
    );
    expect(issues).toEqual([]);
  });

  it('accepts a valid batch with dependencies', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
      ]),
    );
    expect(issues).toEqual([]);
  });

  it('rejects empty tasks', () => {
    const issues = validateSubagentBatchRequest(makeBatch([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('at least one task');
  });

  it('rejects duplicate task ids', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'a' })]),
    );
    expect(issues.some((i) => i.message === 'duplicate task id')).toBe(true);
  });

  it('rejects unknown dependency ids', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask({ id: 'a', dependsOn: ['nonexistent'] })]),
    );
    expect(issues.some((i) => i.message?.includes('nonexistent'))).toBe(true);
  });

  it('rejects self-dependencies', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask({ id: 'a', dependsOn: ['a'] })]),
    );
    expect(issues.some((i) => i.message?.includes('self-dependency'))).toBe(true);
  });

  it('rejects negative maxConcurrency', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask()], { maxConcurrency: 0 }),
    );
    expect(issues.some((i) => i.message?.includes('maxConcurrency'))).toBe(true);
  });

  it('rejects empty task id', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask({ id: '  ' })]),
    );
    expect(issues.some((i) => i.message === 'task id is required')).toBe(true);
  });

  it('accepts parallelGroup and isolationOverride', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([
        makeTask({ id: 'a', parallelGroup: 'g1', isolationOverride: 'readonly' }),
        makeTask({ id: 'b', parallelGroup: 'g1', isolationOverride: 'worktree' }),
      ]),
    );
    expect(issues).toEqual([]);
  });
});
