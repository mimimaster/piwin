import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostStatusData } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

describe('HostRuntime status capabilities', () => {
  it('reports transitional SDK capabilities fail-closed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-status-sdk-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const status = await runtime.handleCommand({ type: 'host/status' });
    expect(status.success).toBe(true);
    if (!status.success) throw new Error(status.error);
    const data = status.data as HostStatusData;
    expect(data.generalWorkspacePath).toBe(join(rootDir, 'workspace'));
    expect(data.capabilities.customTools).toBe(false);
    expect(data.capabilities.subagentWorktree).toBe(false);
    expect(data.capabilities.jobs).toBe(true);
    expect(data.capabilities.productTranscript).toBe(true);
    expect(data.capabilities.mcpLifecycle).toBe(true);
    expect(data.capabilities.compaction).toBe(true);
    expect(data.capabilities.extensions).toBe(true);
    expect(data.capabilities.prompts).toBe(true);
    expect(data.capabilities.extensionUiBridge).toBe(true);
    expect(data.capabilities.sessionPin).toBe(true);
    expect(data.capabilities.sessionSearch).toBe(true);
    expect(data.capabilities.usage).toBe(true);
    expect(data.capabilities.process).toBe(true);
    expect(data.capabilities.sessionExport).toBe(true);
    expect(data.capabilities.sessionLifecycle).toBe(true);
    expect(data.capabilities.pty).toBe(false);
    expect(data.capabilities.subagentDeliveryV1).toBe(false);
    expect(data.capabilities.subagentResultReviewV1).toBe(false);
    expect(data.capabilities.turnChangeUndoV1).toBe(false);
    await runtime.dispose();
  });

  it('reports custom tools false in mock RPC mode', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-status-rpc-'));
    const runtime = new HostRuntime({ mode: 'rpc', mock: true, piwinRoot: rootDir });
    const status = await runtime.handleCommand({ type: 'host/status' });
    expect(status.success).toBe(true);
    if (!status.success) throw new Error(status.error);
    const data = status.data as HostStatusData;
    expect(data.mode).toBe('rpc');
    // Mock RPC does not wire the session tool port; customTools stays false.
    // Live non-mock RPC reports true via isRpcWorkerMode — mock keeps prior mock semantics.
    expect(data.capabilities.customTools).toBe(false);
    expect(data.capabilities.subagentWorktree).toBe(false);
    expect(data.capabilities.subagentDeliveryV1).toBe(false);
    expect(data.capabilities.subagentResultReviewV1).toBe(false);
    expect(data.capabilities.turnChangeUndoV1).toBe(false);
    // mock:true still enables compaction capability flag
    expect(data.capabilities.compaction).toBe(true);
    expect(data.capabilities.extensions).toBe(true);
    expect(data.capabilities.prompts).toBe(true);
    await runtime.dispose();
  });

  it('returns a stable not-ready error for every batch command', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-status-batch-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const commands = [
      {
        type: 'subagent/batch-start' as const,
        request: {
          parentSessionId: 'session-1',
          tasks: [
            {
              id: 'task-1',
              parentSessionId: 'session-1',
              task: 'not executed',
            },
          ],
        },
      },
      { type: 'subagent/batch-status' as const, runId: 'run-1' },
      { type: 'subagent/batch-cancel' as const, runId: 'run-1' },
    ];

    for (const command of commands) {
      const response = await runtime.handleCommand(command);
      expect(response).toMatchObject({
        type: 'response',
        command: command.type,
        success: false,
        error: 'subagent orchestration is not ready in this host runtime',
      });
    }

    await runtime.dispose();
  });
});
