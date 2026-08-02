import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSubagentRunStore } from './subagent-run-store.js';
import type { SubagentBatchRequest, SubagentTaskSpec } from '@piwin/contracts';

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
    maxConcurrency: 4,
    ...overrides,
  };
}

describe('SubagentRunStore', () => {
  it('creates and loads a manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    const manifest = await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    expect(manifest.runId).toBe('run-1');
    expect(manifest.status).toBe('running');
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.runId).toBe('run-1');
  });

  it('records snapshots, leases, and results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.recordSnapshot('run-1', 'a', {
      isolation: 'readonly',
      workingDirectory: '/tmp/project',
    });
    await store.recordLease('run-1', 'a', {
      mode: 'readonly',
      cwd: '/tmp/project',
    });
    await store.recordResult('run-1', 'a', {
      runId: 'run-1',
      taskId: 'a',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'not-requested',
    });
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.snapshots.a?.isolation).toBe('readonly');
    expect(loaded?.leases.a?.cwd).toBe('/tmp/project');
    expect(loaded?.results.a?.executionStatus).toBe('completed');
  });

  it('sets batch status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.setStatus('run-1', 'completed');
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.status).toBe('completed');
  });

  it('reconciles running tasks without live children on restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.recordResult('run-1', 'a', {
      runId: 'run-1',
      taskId: 'a',
      childSessionId: 'child-1',
      executionStatus: 'running',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
    });
    // No live child → should be reconciled to failed.
    const reconciled = await store.reconcile('run-1', () => false);
    expect(reconciled?.results.a?.executionStatus).toBe('failed');
    expect(reconciled?.results.a?.error).toContain('interrupted');
  });

  it('does not reconcile tasks with live children', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.recordResult('run-1', 'a', {
      runId: 'run-1',
      taskId: 'a',
      childSessionId: 'child-1',
      executionStatus: 'running',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
    });
    const reconciled = await store.reconcile('run-1', (id) => id === 'child-1');
    expect(reconciled?.results.a?.executionStatus).toBe('running');
  });

  it('returns undefined for unknown run id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    const loaded = await store.loadManifest('nonexistent');
    expect(loaded).toBeUndefined();
  });
});
