import { describe, expect, it } from 'vitest';
import { RunRegistry } from './run-registry.js';
import type { AgentEvent, ExecutionRunRecord } from '@piwin/contracts';
import { isRunTerminal } from '@piwin/contracts';

/** Deterministic ID generator that returns incrementing IDs. */
function makeIdGen(start = 0): () => string {
  let counter = start;
  return () => `run-${++counter}`;
}

/** Create a registry with deterministic IDs. */
function makeRegistry(idStart = 0): RunRegistry {
  return new RunRegistry({ createId: makeIdGen(idStart) });
}

// ---------------------------------------------------------------------------
// 1. create()
// ---------------------------------------------------------------------------

describe('RunRegistry.create()', () => {
  it('creates a run with correct fields and queued status', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });

    expect(run.runId).toBe('run-1');
    expect(run.kind).toBe('session-turn');
    expect(run.status).toBe('queued');
    expect(run.revision).toBe(1);
    expect(run.sessionId).toBe('sess-1');
    expect(run.rootRunId).toBe('run-1');
    expect(run.parentRunId).toBeUndefined();
    expect(run.startedAt).toBeUndefined();
    expect(run.endedAt).toBeUndefined();
    expect(run.terminalCode).toBeUndefined();
    expect(run.error).toBeUndefined();
  });

  it('sets rootRunId to self when no parent', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'plan-execution', sessionId: 'sess-1' });
    expect(run.rootRunId).toBe(run.runId);
  });

  it('inherits rootRunId from parent when parent exists', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    expect(child.rootRunId).toBe(parent.runId);
    expect(child.parentRunId).toBe(parent.runId);
  });

  it('inherits rootRunId transitively from grandparent', () => {
    const reg = makeRegistry();
    const root = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const mid = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: root.runId });
    const leaf = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: mid.runId });
    expect(leaf.rootRunId).toBe(root.runId);
  });

  it('copies optional fields planId, taskId, runtimeGenerationId', () => {
    const reg = makeRegistry();
    const run = reg.create({
      kind: 'plan-execution',
      sessionId: 'sess-1',
      planId: 'plan-1',
      taskId: 'task-1',
      runtimeGenerationId: 'gen-1',
    });
    expect(run.planId).toBe('plan-1');
    expect(run.taskId).toBe('task-1');
    expect(run.runtimeGenerationId).toBe('gen-1');
  });

  it('registers child in parent children set', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    expect(reg.getChildren(parent.runId)).toEqual([child.runId]);
  });

  it('returns a copy (mutating returned record does not affect registry)', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const mutated = run as Record<string, unknown>;
    mutated.status = 'running';
    expect(reg.get(run.runId)?.status).toBe('queued');
  });

  it('fires onRunUpdated callback', () => {
    const updates: ExecutionRunRecord[] = [];
    const reg = new RunRegistry({
      createId: makeIdGen(),
      onRunUpdated: (r) => updates.push(r),
    });
    reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.runId).toBe('run-1');
  });

  it('throws when creating a child with a non-existent parent', () => {
    const reg = makeRegistry();
    expect(() =>
      reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: 'nonexistent' }),
    ).toThrow('parent run not found: nonexistent');
  });

  it('throws when creating a child with a terminal parent', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(parent.runId);
    reg.terminate(parent.runId, 'completed', 'completed');

    expect(() =>
      reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId }),
    ).toThrow(`parent run is already terminal: ${parent.runId}`);
  });

  it('throws when creating a child with a closed-admission parent', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.closeAdmission(parent.runId);

    expect(() =>
      reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId }),
    ).toThrow(`parent run has closed admission: ${parent.runId}`);
  });
});

// ---------------------------------------------------------------------------
// 2. start()
// ---------------------------------------------------------------------------

describe('RunRegistry.start()', () => {
  it('moves a queued run to running and sets startedAt', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const started = reg.start(run.runId);
    expect(started).toBeDefined();
    expect(started?.status).toBe('running');
    expect(started?.startedAt).toBeDefined();
    expect(typeof started?.startedAt).toBe('string');
  });

  it('returns undefined for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.start('nonexistent')).toBeUndefined();
  });

  it('returns undefined when run is already running', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    expect(reg.start(run.runId)).toBeUndefined();
  });

  it('returns undefined when run is terminal', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');
    expect(reg.start(run.runId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2a. semantic AgentEvent publication
// ---------------------------------------------------------------------------

describe('RunRegistry semantic AgentEvent publication', () => {
  it('publishes only real phase or first-token transitions', () => {
    const updates: ExecutionRunRecord[] = [];
    const reg = new RunRegistry({
      createId: makeIdGen(),
      onRunUpdated: (record) => updates.push(record),
    });
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    updates.length = 0;

    const textDelta: AgentEvent = {
      type: 'message/text_delta',
      messageId: 'message-1',
      delta: 'a',
    };
    const first = reg.noteAgentEvent(run.runId, textDelta);
    expect(first?.phase).toBe('streaming');
    expect(first?.firstTokenReceived).toBe(true);
    expect(first?.revision).toBe(2);
    expect(updates).toHaveLength(1);

    for (let index = 0; index < 100; index += 1) {
      reg.noteAgentEvent(run.runId, { ...textDelta, delta: String(index) });
    }
    reg.noteAgentEvent(run.runId, {
      type: 'message/thinking_delta',
      messageId: 'message-1',
      delta: 'thinking',
    });
    expect(updates).toHaveLength(1);
    expect(reg.get(run.runId)?.revision).toBe(2);

    const toolStart: AgentEvent = {
      type: 'tool/start',
      toolCallId: 'tool-1',
      toolName: 'shell',
    };
    const toolRunning = reg.noteAgentEvent(run.runId, toolStart);
    expect(toolRunning?.phase).toBe('tool-running');
    expect(toolRunning?.revision).toBe(3);
    expect(updates).toHaveLength(2);

    reg.noteAgentEvent(run.runId, toolStart);
    expect(updates).toHaveLength(2);

    const toolEnd: AgentEvent = {
      type: 'tool/end',
      toolCallId: 'tool-1',
      isError: false,
    };
    const streaming = reg.noteAgentEvent(run.runId, toolEnd);
    expect(streaming?.phase).toBe('streaming');
    expect(streaming?.revision).toBe(4);
    expect(updates).toHaveLength(3);

    const permission: AgentEvent = {
      type: 'permission/request',
      requestId: 'permission-1',
      action: 'shell',
      detail: 'run shell',
      defaultDecision: 'ask',
    };
    const waiting = reg.noteAgentEvent(run.runId, permission);
    expect(waiting?.phase).toBe('waiting-permission');
    expect(waiting?.revision).toBe(5);
    expect(updates).toHaveLength(4);

    reg.noteAgentEvent(run.runId, permission);
    expect(updates).toHaveLength(4);
  });

  it('ignores an explicitly mismatched Run ID without publishing', () => {
    const updates: ExecutionRunRecord[] = [];
    const reg = new RunRegistry({
      createId: makeIdGen(),
      onRunUpdated: (record) => updates.push(record),
    });
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    updates.length = 0;

    const result = reg.noteAgentEvent(run.runId, {
      type: 'message/text_delta',
      messageId: 'message-1',
      delta: 'ignored',
      runId: 'different-run',
    });

    expect(result).toBeUndefined();
    expect(updates).toHaveLength(0);
    expect(reg.get(run.runId)?.revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. terminate()
// ---------------------------------------------------------------------------

describe('RunRegistry.terminate()', () => {
  it('transitions to completed with endedAt and terminalCode', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const result = reg.terminate(run.runId, 'completed', 'completed');
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
    expect(result?.endedAt).toBeDefined();
    expect(result?.terminalCode).toBe('completed');
  });

  it('transitions to failed with error message', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const result = reg.terminate(run.runId, 'failed', 'failed', 'something went wrong');
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('something went wrong');
  });

  it('transitions to cancelled', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const result = reg.terminate(run.runId, 'cancelled', 'cancelled');
    expect(result?.status).toBe('cancelled');
  });

  it('transitions to interrupted', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const result = reg.terminate(run.runId, 'interrupted', 'interrupted');
    expect(result?.status).toBe('interrupted');
  });

  it('can terminate a queued run without starting it first', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const result = reg.terminate(run.runId, 'cancelled', 'cancelled');
    expect(result?.status).toBe('cancelled');
    expect(result?.endedAt).toBeDefined();
    expect(result?.startedAt).toBeUndefined();
  });

  it('returns undefined for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.terminate('nonexistent', 'completed', 'completed')).toBeUndefined();
  });

  it('fires onRunTerminal callback', () => {
    const terminal: ExecutionRunRecord[] = [];
    const reg = new RunRegistry({
      createId: makeIdGen(),
      onRunTerminal: (r) => terminal.push(r),
    });
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.runId).toBe(run.runId);
  });
});

// ---------------------------------------------------------------------------
// 4. Terminal immutability
// ---------------------------------------------------------------------------

describe('RunRegistry terminal immutability', () => {
  it('terminal run cannot be terminated again — returns undefined', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');
    expect(reg.terminate(run.runId, 'failed', 'failed')).toBeUndefined();
  });

  it('terminal run status does not change after re-terminate attempt', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');
    reg.terminate(run.runId, 'failed', 'failed');
    expect(reg.get(run.runId)?.status).toBe('completed');
  });

  it('start() does not work on terminal run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.terminate(run.runId, 'cancelled', 'cancelled');
    expect(reg.start(run.runId)).toBeUndefined();
    expect(reg.get(run.runId)?.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// 5. Parent-child join (SC-09)
// ---------------------------------------------------------------------------

describe('RunRegistry SC-09: parent-child join', () => {
  it('parent cannot terminate while child is non-terminal', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child.runId);

    // Parent cannot terminate while child is running.
    expect(reg.terminate(parent.runId, 'completed', 'completed')).toBeUndefined();
    expect(reg.get(parent.runId)?.status).toBe('running');
  });

  it('parent can terminate after child terminates', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child.runId);

    reg.terminate(child.runId, 'completed', 'completed');
    // Now parent can terminate.
    const result = reg.terminate(parent.runId, 'completed', 'completed');
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
  });

  it('parent cannot terminate while grandchild is non-terminal', () => {
    const reg = makeRegistry();
    const root = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const mid = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: root.runId });
    const leaf = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: mid.runId });
    reg.start(root.runId);
    reg.start(mid.runId);
    reg.start(leaf.runId);

    // Terminate mid — should fail because leaf is still running.
    expect(reg.terminate(mid.runId, 'completed', 'completed')).toBeUndefined();

    // Terminate leaf first.
    reg.terminate(leaf.runId, 'completed', 'completed');
    // Now mid can terminate.
    expect(reg.terminate(mid.runId, 'completed', 'completed')).toBeDefined();
    // Now root can terminate.
    expect(reg.terminate(root.runId, 'completed', 'completed')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. cancelRun()
// ---------------------------------------------------------------------------

describe('RunRegistry.cancelRun()', () => {
  it('requests cancellation for a single leaf run without terminalizing it', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const result = reg.cancelRun(run.runId);
    expect(result.requestedRunIds).toEqual([run.runId]);
    expect(result.cancelledRunIds).toEqual([]);
    expect(result.alreadyTerminalRunIds).toEqual([]);
    expect(reg.get(run.runId)?.status).toBe('cancelling');

    reg.terminate(run.runId, 'cancelled', 'cancelled');
    expect(reg.get(run.runId)?.status).toBe('cancelled');
  });

  it('requests cancellation for target and descendants without auto-terminalizing', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child1 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    const child2 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child1.runId);
    reg.start(child2.runId);

    const result = reg.cancelRun(parent.runId);
    expect(result.requestedRunIds).toHaveLength(3);
    expect(result.requestedRunIds).toContain(parent.runId);
    expect(result.requestedRunIds).toContain(child1.runId);
    expect(result.requestedRunIds).toContain(child2.runId);
    expect(result.cancelledRunIds).toEqual([]);

    // Owners must acknowledge cancellation explicitly.
    for (const id of result.requestedRunIds) {
      expect(reg.get(id)?.status).toBe('cancelling');
    }

    reg.terminate(child1.runId, 'cancelled', 'cancelled');
    reg.terminate(child2.runId, 'cancelled', 'cancelled');
    reg.terminate(parent.runId, 'cancelled', 'cancelled');
  });

  it('closes admission for the entire subtree', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child.runId);

    reg.cancelRun(parent.runId);

    // After cancellation, new children should not be added to parent.
    // Admission is closed even while the owner is still joining.
    expect(() =>
      reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: parent.runId }),
    ).toThrow(`parent run has closed admission: ${parent.runId}`);
  });

  it('aborts AbortSignals for cancelled runs', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child.runId);

    const parentSignal = reg.getSignal(parent.runId);
    const childSignal = reg.getSignal(child.runId);

    reg.cancelRun(parent.runId);

    expect(parentSignal?.aborted).toBe(true);
    expect(childSignal?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. cancelRun() on already-terminal
// ---------------------------------------------------------------------------

describe('RunRegistry.cancelRun() on already-terminal', () => {
  it('returns alreadyTerminalRunIds for a completed run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');

    const result = reg.cancelRun(run.runId);
    expect(result.cancelledRunIds).toEqual([]);
    expect(result.alreadyTerminalRunIds).toEqual([run.runId]);
  });

  it('returns alreadyTerminalRunIds for a failed run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'failed', 'failed');

    const result = reg.cancelRun(run.runId);
    expect(result.alreadyTerminalRunIds).toEqual([run.runId]);
  });

  it('returns empty result for non-existent run', () => {
    const reg = makeRegistry();
    const result = reg.cancelRun('nonexistent');
    expect(result.cancelledRunIds).toEqual([]);
    expect(result.alreadyTerminalRunIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. join()
// ---------------------------------------------------------------------------

describe('RunRegistry.join()', () => {
  it('resolves immediately for a terminal run', async () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');

    const result = await reg.join(run.runId);
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
  });

  it('resolves immediately for a run that was never started but terminated', async () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.terminate(run.runId, 'cancelled', 'cancelled');

    const result = await reg.join(run.runId);
    expect(result?.status).toBe('cancelled');
  });

  it('waits for a non-terminal run and resolves after termination', async () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);

    // Start join — should not resolve yet.
    let resolved = false;
    const joinPromise = reg.join(run.runId).then((r) => {
      resolved = true;
      return r;
    });

    // Allow microtasks to flush.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Terminate the run.
    reg.terminate(run.runId, 'completed', 'completed');

    const result = await joinPromise;
    expect(resolved).toBe(true);
    expect(result?.status).toBe('completed');
  });

  it('returns undefined for non-existent run', async () => {
    const reg = makeRegistry();
    const result = await reg.join('nonexistent');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. closeAdmission()
// ---------------------------------------------------------------------------

describe('RunRegistry.closeAdmission()', () => {
  it('prevents new children from being added', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child1 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    expect(reg.getChildren(parent.runId)).toEqual([child1.runId]);

    reg.closeAdmission(parent.runId);

    // After admission is closed, creating a child should throw.
    expect(() =>
      reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId }),
    ).toThrow(`parent run has closed admission: ${parent.runId}`);
  });

  it('does not throw for non-existent run', () => {
    const reg = makeRegistry();
    expect(() => reg.closeAdmission('nonexistent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. list()
// ---------------------------------------------------------------------------

describe('RunRegistry.list()', () => {
  function setupListRegistry(): RunRegistry {
    const reg = makeRegistry();
    // run-1: session-turn, sess-A, root
    reg.create({ kind: 'session-turn', sessionId: 'sess-A' });
    // run-2: subagent-batch, sess-A, parent run-1
    reg.create({ kind: 'subagent-batch', sessionId: 'sess-A', parentRunId: 'run-1' });
    // run-3: subagent-task, sess-A, parent run-2
    reg.create({ kind: 'subagent-task', sessionId: 'sess-A', parentRunId: 'run-2' });
    // run-4: session-turn, sess-B, root
    reg.create({ kind: 'session-turn', sessionId: 'sess-B' });
    return reg;
  }

  it('returns all runs when no filter', () => {
    const reg = setupListRegistry();
    const all = reg.list();
    expect(all).toHaveLength(4);
  });

  it('filters by single status', () => {
    const reg = setupListRegistry();
    reg.start('run-1');
    const running = reg.list({ status: 'running' });
    expect(running).toHaveLength(1);
    expect(running[0]!.runId).toBe('run-1');
  });

  it('filters by multiple statuses', () => {
    const reg = setupListRegistry();
    reg.start('run-1');
    reg.terminate('run-4', 'cancelled', 'cancelled');
    const filtered = reg.list({ status: ['running', 'cancelled'] });
    expect(filtered).toHaveLength(2);
    const ids = filtered.map((r) => r.runId).sort();
    expect(ids).toEqual(['run-1', 'run-4']);
  });

  it('filters by kind', () => {
    const reg = setupListRegistry();
    const batches = reg.list({ kind: 'subagent-batch' });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.runId).toBe('run-2');
  });

  it('filters by sessionId', () => {
    const reg = setupListRegistry();
    const sessA = reg.list({ sessionId: 'sess-A' });
    expect(sessA).toHaveLength(3);
    const sessB = reg.list({ sessionId: 'sess-B' });
    expect(sessB).toHaveLength(1);
  });

  it('filters by parentRunId', () => {
    const reg = setupListRegistry();
    const children = reg.list({ parentRunId: 'run-1' });
    expect(children).toHaveLength(1);
    expect(children[0]!.runId).toBe('run-2');
  });

  it('filters by rootRunId', () => {
    const reg = setupListRegistry();
    const rooted = reg.list({ rootRunId: 'run-1' });
    expect(rooted).toHaveLength(3);
    const ids = rooted.map((r) => r.runId).sort();
    expect(ids).toEqual(['run-1', 'run-2', 'run-3']);
  });

  it('combines multiple filters', () => {
    const reg = setupListRegistry();
    const result = reg.list({ sessionId: 'sess-A', kind: 'subagent-task' });
    expect(result).toHaveLength(1);
    expect(result[0]!.runId).toBe('run-3');
  });

  it('returns copies (mutating returned records does not affect registry)', () => {
    const reg = setupListRegistry();
    const all = reg.list();
    const mutated = all[0] as Record<string, unknown>;
    mutated.status = 'completed';
    expect(reg.get(all[0]!.runId)?.status).toBe('queued');
  });
});

// ---------------------------------------------------------------------------
// 11. getChildren()
// ---------------------------------------------------------------------------

describe('RunRegistry.getChildren()', () => {
  it('returns direct child run IDs', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child1 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    const child2 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    // grandchild — should NOT appear in parent's children.
    reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: child1.runId });

    const children = reg.getChildren(parent.runId).sort();
    expect(children).toEqual([child1.runId, child2.runId].sort());
  });

  it('returns empty array for a run with no children', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    expect(reg.getChildren(run.runId)).toEqual([]);
  });

  it('returns empty array for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.getChildren('nonexistent')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 12. getSignal()
// ---------------------------------------------------------------------------

describe('RunRegistry.getSignal()', () => {
  it('returns an AbortSignal for an existing run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const signal = reg.getSignal(run.runId);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('returns undefined for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.getSignal('nonexistent')).toBeUndefined();
  });

  it('signal becomes aborted when run is cancelled', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const signal = reg.getSignal(run.runId);
    reg.cancelRun(run.runId);
    expect(signal?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. Cascading join — when last child terminates, waiting parent can terminate
// ---------------------------------------------------------------------------

describe('RunRegistry cascading join', () => {
  it('parent remains cancelling until its owner explicitly terminates it', () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child1 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    const child2 = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child1.runId);
    reg.start(child2.runId);

    // Cancellation requests abort from the leaves upward but does not join any
    // owner on their behalf.
    const result = reg.cancelRun(parent.runId);
    expect(result.requestedRunIds).toHaveLength(3);
    expect(reg.get(parent.runId)?.status).toBe('cancelling');

    reg.terminate(child1.runId, 'cancelled', 'cancelled');
    reg.terminate(child2.runId, 'cancelled', 'cancelled');
    expect(reg.get(parent.runId)?.status).toBe('cancelling');
    expect(reg.terminate(parent.runId, 'cancelled', 'cancelled')?.status).toBe('cancelled');
  });

  it('parent in cancelling state waits for non-leaf children to terminate', () => {
    const reg = makeRegistry();
    const root = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const mid = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: root.runId });
    const leaf1 = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: mid.runId });
    const leaf2 = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: mid.runId });
    reg.start(root.runId);
    reg.start(mid.runId);
    reg.start(leaf1.runId);
    reg.start(leaf2.runId);

    // Cancel root — requests cancellation through the entire tree.
    const result = reg.cancelRun(root.runId);
    // All owners must still acknowledge their joins.
    expect(reg.get(root.runId)?.status).toBe('cancelling');
    expect(reg.get(mid.runId)?.status).toBe('cancelling');
    expect(reg.get(leaf1.runId)?.status).toBe('cancelling');
    expect(reg.get(leaf2.runId)?.status).toBe('cancelling');
    expect(result.requestedRunIds).toHaveLength(4);

    reg.terminate(leaf1.runId, 'cancelled', 'cancelled');
    reg.terminate(leaf2.runId, 'cancelled', 'cancelled');
    reg.terminate(mid.runId, 'cancelled', 'cancelled');
    reg.terminate(root.runId, 'cancelled', 'cancelled');
  });

  it('join() on parent resolves only after explicit parent termination', async () => {
    const reg = makeRegistry();
    const parent = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const child = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1', parentRunId: parent.runId });
    reg.start(parent.runId);
    reg.start(child.runId);

    let parentResolved = false;
    const parentJoin = reg.join(parent.runId).then((r) => {
      parentResolved = true;
      return r;
    });

    // Cancellation requests both owners but does not resolve either join.
    reg.cancelRun(parent.runId);
    reg.terminate(child.runId, 'cancelled', 'cancelled');
    await Promise.resolve();
    expect(parentResolved).toBe(false);

    reg.terminate(parent.runId, 'cancelled', 'cancelled');

    const result = await parentJoin;
    expect(parentResolved).toBe(true);
    expect(result?.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// 14. Deep tree cancellation: batch → task → subtask
// ---------------------------------------------------------------------------

describe('RunRegistry deep tree cancellation', () => {
  it('requests cancellation for a 3-level tree from root', () => {
    const reg = makeRegistry();
    // Level 0: batch (root)
    const batch = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1' });
    // Level 1: tasks
    const task1 = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: batch.runId });
    const task2 = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: batch.runId });
    // Level 2: subtasks
    const subtask1a = reg.create({ kind: 'session-turn', sessionId: 'sess-1', parentRunId: task1.runId });
    const subtask1b = reg.create({ kind: 'session-turn', sessionId: 'sess-1', parentRunId: task1.runId });
    const subtask2a = reg.create({ kind: 'session-turn', sessionId: 'sess-1', parentRunId: task2.runId });

    reg.start(batch.runId);
    reg.start(task1.runId);
    reg.start(task2.runId);
    reg.start(subtask1a.runId);
    reg.start(subtask1b.runId);
    reg.start(subtask2a.runId);

    const result = reg.cancelRun(batch.runId);

    // All 6 runs should await owner acknowledgement.
    expect(result.requestedRunIds).toHaveLength(6);
    for (const id of [batch.runId, task1.runId, task2.runId, subtask1a.runId, subtask1b.runId, subtask2a.runId]) {
      expect(reg.get(id)?.status).toBe('cancelling');
    }

    // All signals should be aborted.
    for (const id of [batch.runId, task1.runId, task2.runId, subtask1a.runId, subtask1b.runId, subtask2a.runId]) {
      expect(reg.getSignal(id)?.aborted).toBe(true);
    }

    // Owners join bottom-up, then the parent owners can terminate.
    reg.terminate(subtask1a.runId, 'cancelled', 'cancelled');
    reg.terminate(subtask1b.runId, 'cancelled', 'cancelled');
    reg.terminate(subtask2a.runId, 'cancelled', 'cancelled');
    reg.terminate(task1.runId, 'cancelled', 'cancelled');
    reg.terminate(task2.runId, 'cancelled', 'cancelled');
    expect(reg.terminate(batch.runId, 'cancelled', 'cancelled')?.status).toBe('cancelled');
  });

  it('cancels a 3-level tree when some descendants are already terminal', () => {
    const reg = makeRegistry();
    const batch = reg.create({ kind: 'subagent-batch', sessionId: 'sess-1' });
    const task1 = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: batch.runId });
    const task2 = reg.create({ kind: 'subagent-task', sessionId: 'sess-1', parentRunId: batch.runId });
    const subtask1 = reg.create({ kind: 'session-turn', sessionId: 'sess-1', parentRunId: task1.runId });
    const subtask2 = reg.create({ kind: 'session-turn', sessionId: 'sess-1', parentRunId: task2.runId });

    reg.start(batch.runId);
    reg.start(task1.runId);
    reg.start(task2.runId);
    reg.start(subtask1.runId);
    reg.start(subtask2.runId);

    // Complete task1 and its subtask first.
    reg.terminate(subtask1.runId, 'completed', 'completed');
    reg.terminate(task1.runId, 'completed', 'completed');

    // Now cancel batch — should request task2, subtask2, and batch.
    const result = reg.cancelRun(batch.runId);

    // task1 and subtask1 should remain completed.
    expect(reg.get(task1.runId)?.status).toBe('completed');
    expect(reg.get(subtask1.runId)?.status).toBe('completed');

    // batch, task2, subtask2 should remain cancelling until their owners join.
    expect(reg.get(batch.runId)?.status).toBe('cancelling');
    expect(reg.get(task2.runId)?.status).toBe('cancelling');
    expect(reg.get(subtask2.runId)?.status).toBe('cancelling');

    expect(result.requestedRunIds).toHaveLength(3);
    expect(result.requestedRunIds).toContain(batch.runId);
    expect(result.requestedRunIds).toContain(task2.runId);
    expect(result.requestedRunIds).toContain(subtask2.runId);

    reg.terminate(subtask2.runId, 'cancelled', 'cancelled');
    reg.terminate(task2.runId, 'cancelled', 'cancelled');
    reg.terminate(batch.runId, 'cancelled', 'cancelled');
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('RunRegistry edge cases', () => {
  it('isActive() returns true for non-terminal run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    expect(reg.isActive(run.runId)).toBe(true);
  });

  it('isActive() returns false for terminal run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.terminate(run.runId, 'completed', 'completed');
    expect(reg.isActive(run.runId)).toBe(false);
  });

  it('isActive() returns false for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.isActive('nonexistent')).toBe(false);
  });

  it('get() returns undefined for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('get() returns a copy', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const fetched = reg.get(run.runId);
    const mutated = fetched as Record<string, unknown>;
    mutated.status = 'completed';
    expect(reg.get(run.runId)?.status).toBe('queued');
  });

  it('getAbortController() returns the controller for an existing run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    const controller = reg.getAbortController(run.runId);
    expect(controller).toBeInstanceOf(AbortController);
  });

  it('getAbortController() returns undefined for non-existent run', () => {
    const reg = makeRegistry();
    expect(reg.getAbortController('nonexistent')).toBeUndefined();
  });

  it('clear() removes all runs', () => {
    const reg = makeRegistry();
    reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.create({ kind: 'session-turn', sessionId: 'sess-2' });
    expect(reg.list()).toHaveLength(2);
    reg.clear();
    expect(reg.list()).toHaveLength(0);
  });

  it('terminate with no terminalCode or error works', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    const result = reg.terminate(run.runId, 'interrupted');
    expect(result?.status).toBe('interrupted');
    expect(result?.terminalCode).toBeUndefined();
    expect(result?.error).toBeUndefined();
  });

  it('all terminal statuses are recognized by isRunTerminal', () => {
    const terminalStatuses = ['completed', 'failed', 'cancelled', 'interrupted'] as const;
    for (const status of terminalStatuses) {
      expect(isRunTerminal(status)).toBe(true);
    }
    const nonTerminalStatuses = ['queued', 'running', 'cancelling'] as const;
    for (const status of nonTerminalStatuses) {
      expect(isRunTerminal(status)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 15. attachRuntimeGeneration() — ADR 0040 §7
// ---------------------------------------------------------------------------

describe('RunRegistry.attachRuntimeGeneration()', () => {
  it('attaches a generation to a non-terminal Run exactly once', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);

    const attached = reg.attachRuntimeGeneration(run.runId, 'gen-1');
    expect(attached.ok).toBe(true);
    if (attached.ok) {
      expect(attached.run.runtimeGenerationId).toBe('gen-1');
    }
    expect(reg.get(run.runId)?.runtimeGenerationId).toBe('gen-1');
  });

  it('is idempotent when re-attaching the same generation', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);

    expect(reg.attachRuntimeGeneration(run.runId, 'gen-1').ok).toBe(true);
    const reattached = reg.attachRuntimeGeneration(run.runId, 'gen-1');
    expect(reattached.ok).toBe(true);
    if (reattached.ok) {
      expect(reattached.run.runtimeGenerationId).toBe('gen-1');
    }
  });

  it('rejects a different generation as a correlation error', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);

    expect(reg.attachRuntimeGeneration(run.runId, 'gen-1').ok).toBe(true);
    const rebound = reg.attachRuntimeGeneration(run.runId, 'gen-2');
    expect(rebound).toEqual({ ok: false, reason: 'already-attached' });
    expect(reg.get(run.runId)?.runtimeGenerationId).toBe('gen-1');
  });

  it('cannot attach to a terminal Run', () => {
    const reg = makeRegistry();
    const run = reg.create({ kind: 'session-turn', sessionId: 'sess-1' });
    reg.start(run.runId);
    reg.terminate(run.runId, 'completed', 'completed');

    expect(reg.attachRuntimeGeneration(run.runId, 'gen-1')).toEqual({
      ok: false,
      reason: 'terminal',
    });
  });

  it('cannot attach to a missing Run', () => {
    const reg = makeRegistry();
    expect(reg.attachRuntimeGeneration('missing', 'gen-1')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });
});

describe('RunRegistry checkpoint pause', () => {
  it('closes admission, aborts the signal, and keeps pause distinct from cancel', () => {
    const reg = makeRegistry();
    const run = reg.createForegroundRun('sess-pause');
    const requested = reg.requestPause(run.runId, { code: 'pause-requested' });

    expect(requested?.status).toBe('cancelling');
    expect(requested?.phase).toBe('pausing');
    expect(reg.isPauseRequested(run.runId)).toBe(true);
    expect(reg.getSignal(run.runId)?.aborted).toBe(true);
    expect(reg.getSignal(run.runId)?.reason).toEqual({ code: 'pause-requested' });
    expect(reg.terminate(run.runId, 'interrupted', 'paused')?.terminalCode).toBe('paused');
  });

  it('attaches the checkpoint reference before the interrupted terminal push', () => {
    const reg = makeRegistry();
    const run = reg.createForegroundRun('sess-pause');
    reg.requestPause(run.runId);
    expect(reg.attachResumeCheckpoint(run.runId, 'checkpoint-1')?.resumeCheckpointId).toBe(
      'checkpoint-1',
    );
    expect(reg.terminate(run.runId, 'interrupted', 'paused')?.resumeCheckpointId).toBe(
      'checkpoint-1',
    );
  });

  it('reports active descendants so callers can reject partial tree pauses', () => {
    const reg = makeRegistry();
    const parent = reg.createForegroundRun('sess-pause');
    const child = reg.create({
      kind: 'subagent-task',
      sessionId: 'sess-pause',
      parentRunId: parent.runId,
    });
    expect(reg.hasActiveDescendants(parent.runId)).toBe(true);
    reg.start(child.runId);
    reg.terminate(child.runId, 'completed', 'completed');
    expect(reg.hasActiveDescendants(parent.runId)).toBe(false);
  });
});
