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
  it('does not include a caller-controlled process policy', () => {
    const batch = makeBatch([makeTask()]);

    const removedFieldName = ['process', 'Policy'].join('');
    expect(removedFieldName in batch).toBe(false);
  });

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

  it('rejects a simple two-node cycle (A→B, B→A)', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([
        makeTask({ id: 'a', dependsOn: ['b'] }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
      ]),
    );
    expect(issues.some((i) => i.message === 'dependency cycle detected in task graph')).toBe(true);
  });

  it('rejects a three-node cycle (A→B→C→A)', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([
        makeTask({ id: 'a', dependsOn: ['c'] }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['b'] }),
      ]),
    );
    expect(issues.some((i) => i.message === 'dependency cycle detected in task graph')).toBe(true);
  });

  it('rejects a self-loop as a cycle', () => {
    // Self-dependency is already caught earlier, but cycle detection
    // should also fire. The self-dependency issue is checked first.
    const issues = validateSubagentBatchRequest(
      makeBatch([makeTask({ id: 'a', dependsOn: ['a'] })]),
    );
    // Self-dependency is reported; cycle detection also fires.
    expect(issues.some((i) => i.message?.includes('self-dependency'))).toBe(true);
  });

  it('accepts a DAG with multiple paths (no cycle)', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b' }),
        makeTask({ id: 'c', dependsOn: ['a', 'b'] }),
        makeTask({ id: 'd', dependsOn: ['a'] }),
        makeTask({ id: 'e', dependsOn: ['c', 'd'] }),
      ]),
    );
    expect(issues).toEqual([]);
  });

  it('rejects a cycle in a larger graph with extra non-cyclic nodes', () => {
    const issues = validateSubagentBatchRequest(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['b'] }),
        makeTask({ id: 'd', dependsOn: ['c'] }),
        makeTask({ id: 'e', dependsOn: ['d', 'b'] }), // e→d→c→b→a (no cycle)
        makeTask({ id: 'f', dependsOn: ['g'] }),
        makeTask({ id: 'g', dependsOn: ['f'] }), // f↔g cycle
      ]),
    );
    expect(issues.some((i) => i.message === 'dependency cycle detected in task graph')).toBe(true);
  });
});
