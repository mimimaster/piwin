import { describe, it, expect, vi } from 'vitest';
import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { createSubagentRunTool } from './subagent-run-tool.js';

type SpawnCall = {
  parentSessionId: string;
  invocationId: string;
  parentRunId: string;
  parentToolCallId?: string;
  task: string;
  mode?: string;
  applyPolicy?: string;
  sessionName?: string;
  profileId?: string;
};

const fakeSeam = (overrides?: {
  spawn?: ReturnType<typeof vi.fn>;
  merge?: ReturnType<typeof vi.fn>;
}) => {
  const spawn =
    overrides?.spawn ??
    vi.fn(async () => ({
      childSessionId: 'child-1',
      batchStatus: 'completed' as const,
      executionStatus: 'completed' as const,
      integrationStatus: 'not-requested' as const,
    }));
  const merge = overrides?.merge ?? vi.fn(async () => ({ summaryPreview: 'did the thing' }));
  return { spawn, merge };
};

/** Safely extract the first spawn call argument (noUncheckedIndexedAccess). */
function firstSpawnArg(seam: ReturnType<typeof fakeSeam>): SpawnCall {
  const calls = seam.spawn.mock.calls as unknown as SpawnCall[][];
  const firstCall = calls[0];
  if (!firstCall) throw new Error('spawn was not called');
  const arg = firstCall[0];
  if (!arg) throw new Error('spawn call had no arguments');
  return arg;
}

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
  toolCallId?: string,
): Promise<ToolResult> {
  return tool.execute(args, signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    ...(toolCallId ? { toolCallId } : {}),
    toolName: tool.descriptor.name,
  });
}

function messageOf(result: ToolResult): string {
  return result.ok ? result.output : result.message;
}

describe('createSubagentRunTool', () => {
  it('has correct tool name and required parameters', () => {
    const tool = createSubagentRunTool({
      sessionId: 's1',
      seam: fakeSeam(),
    });
    expect(tool.descriptor.name).toBe('piwin_subagent_run');
    expect(tool.descriptor.parameters.required).toEqual(['task']);
    expect(tool.descriptor.parameters.properties).toHaveProperty('task');
    expect(tool.descriptor.parameters.properties).toHaveProperty('mode');
    expect(tool.descriptor.parameters.properties).toHaveProperty('sessionName');
  });

  it('spawns, merges, and returns summary on success', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 'parent-1', seam });
    const result = await executeTool(tool, { task: 'explore the auth module' });
    expect(seam.spawn).toHaveBeenCalledTimes(1);
    expect(firstSpawnArg(seam)).toEqual({
      parentSessionId: 'parent-1',
      invocationId: expect.any(String),
      parentRunId: 'run-1',
      task: 'explore the auth module',
      mode: 'readonly',
      signal: expect.any(AbortSignal),
    });
    expect(seam.merge).toHaveBeenCalledTimes(1);
    expect(messageOf(result)).toContain('subagent completed');
    expect(messageOf(result)).toContain('did the thing');
    expect(messageOf(result)).toContain('childSessionId=child-1');
  });

  it('defaults to readonly mode', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'test' });
    expect(firstSpawnArg(seam).mode).toBe('readonly');
  });

  it('binds the Host-normalized parent tool call to the child task', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'inspect the repository' }, undefined, 'piw-t-parent-1');
    expect(firstSpawnArg(seam).parentToolCallId).toBe('piw-t-parent-1');
    expect(firstSpawnArg(seam).parentRunId).toBe('run-1');
    expect(firstSpawnArg(seam).invocationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets a selected profile provide isolation when mode is omitted', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'implement the change', profileId: 'implementer' });
    expect(firstSpawnArg(seam).profileId).toBe('implementer');
    expect(firstSpawnArg(seam).mode).toBeUndefined();
  });

  it('passes worktree mode through', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'test', mode: 'worktree' });
    expect(firstSpawnArg(seam).mode).toBe('worktree');
  });

  it('passes sessionName through when provided', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'test', sessionName: 'explorer-1' });
    expect(firstSpawnArg(seam).sessionName).toBe('explorer-1');
  });

  it('omits sessionName when not provided', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'test' });
    expect(firstSpawnArg(seam).sessionName).toBeUndefined();
  });

  it('forwards applyPolicy to spawn when provided', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 'parent-1', seam });
    await executeTool(tool, { task: 't', mode: 'worktree', applyPolicy: 'auto' });
    expect(firstSpawnArg(seam).applyPolicy).toBe('auto');
  });

  it('forwards explicit applyPolicy with allowed paths intent', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 'parent-1', seam });
    await executeTool(tool, { task: 't', mode: 'worktree', applyPolicy: 'explicit' });
    expect(firstSpawnArg(seam).applyPolicy).toBe('explicit');
  });

  it('omits applyPolicy when none or invalid', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await executeTool(tool, { task: 'test' });
    expect(firstSpawnArg(seam).applyPolicy).toBeUndefined();
    await executeTool(tool, { task: 'test', applyPolicy: 'bogus' });
    expect(firstSpawnArg(seam).applyPolicy).toBeUndefined();
  });

  it('declares applyPolicy in the tool schema', () => {
    const tool = createSubagentRunTool({ sessionId: 's1', seam: fakeSeam() });
    const properties = tool.descriptor.parameters.properties as Record<string, { enum?: string[] }>;
    expect(properties).toHaveProperty('applyPolicy');
    expect(properties.applyPolicy?.enum).toEqual(['none', 'auto', 'explicit']);
  });

  it('rejects empty task', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await executeTool(tool, { task: '' });
    expect(result).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(messageOf(result)).toContain('task is required');
    expect(seam.spawn).not.toHaveBeenCalled();
  });

  it('rejects invalid mode', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await executeTool(tool, { task: 'test', mode: 'sandbox' });
    expect(messageOf(result)).toContain('invalid mode');
    expect(seam.spawn).not.toHaveBeenCalled();
  });

  it('returns error when spawn throws', async () => {
    const seam = fakeSeam({
      spawn: vi.fn(async () => {
        throw new Error('depth max exceeded');
      }),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await executeTool(tool, { task: 'test' });
    expect(result).toMatchObject({ ok: false, code: 'subagent-failed' });
    expect(messageOf(result)).toContain('depth max exceeded');
    expect(seam.merge).not.toHaveBeenCalled();
  });

  it('returns needs-integration instead of success when worktree integration conflicts', async () => {
    const seam = fakeSeam({
      spawn: vi.fn(async () => ({
        childSessionId: 'child-conflict',
        batchStatus: 'needs-integration' as const,
        executionStatus: 'completed' as const,
        integrationStatus: 'conflict' as const,
        error: 'integration conflict in: game.js',
        worktreePath: '/tmp/worktree',
      })),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });

    const result = await executeTool(tool, { task: 'implement game', mode: 'worktree' });

    expect(result).toMatchObject({
      ok: false,
      code: 'subagent-needs-integration',
      details: {
        integrationStatus: 'conflict',
        worktreePath: '/tmp/worktree',
      },
    });
    expect(messageOf(result)).toContain('integration conflict in: game.js');
    expect(messageOf(result)).toContain('did the thing');
    expect(seam.merge).toHaveBeenCalledWith('child-conflict');
  });

  it('returns failure when a child session exists but its batch failed', async () => {
    const seam = fakeSeam({
      spawn: vi.fn(async () => ({
        childSessionId: 'child-failed',
        batchStatus: 'failed' as const,
        executionStatus: 'failed' as const,
        integrationStatus: 'not-requested' as const,
        error: 'provider failed',
      })),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });

    const result = await executeTool(tool, { task: 'implement game' });

    expect(result).toMatchObject({ ok: false, code: 'subagent-failed' });
    expect(messageOf(result)).toContain('provider failed');
  });

  it('reports cleanup warnings without reversing an applied integration', async () => {
    const seam = fakeSeam({
      spawn: vi.fn(async () => ({
        childSessionId: 'child-applied',
        batchStatus: 'completed' as const,
        executionStatus: 'completed' as const,
        integrationStatus: 'applied' as const,
        error: 'integration applied; retained worktree cleanup failed: busy',
      })),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });

    const result = await executeTool(tool, { task: 'implement game' });

    expect(result).toMatchObject({
      ok: true,
      details: { integrationStatus: 'applied', warning: expect.stringContaining('cleanup failed') },
    });
    expect(messageOf(result)).toContain('Warning: integration applied');
  });

  it('returns error when merge throws', async () => {
    const seam = fakeSeam({
      merge: vi.fn(async () => {
        throw new Error('unknown child');
      }),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await executeTool(tool, { task: 'test' });
    expect(result).toMatchObject({ ok: false, code: 'subagent-failed' });
    expect(messageOf(result)).toContain('subagent merge failed');
    expect(messageOf(result)).toContain('unknown child');
  });

  it('handles alreadyMerged from merge seam', async () => {
    const seam = fakeSeam({
      merge: vi.fn(async () => ({
        summaryPreview: 'cached summary',
        alreadyMerged: true,
      })),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await executeTool(tool, { task: 'test' });
    expect(messageOf(result)).toContain('summary from prior merge');
    expect(messageOf(result)).toContain('cached summary');
  });

  it('handles missing summaryPreview gracefully', async () => {
    const seam = fakeSeam({
      merge: vi.fn(async () => ({})),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await executeTool(tool, { task: 'test' });
    expect(messageOf(result)).toContain('(no summary)');
  });

  it('respects abort signal before spawn', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const controller = new AbortController();
    controller.abort();
    const result = await executeTool(tool, { task: 'test' }, controller.signal);
    expect(messageOf(result)).toContain('aborted before spawn');
    expect(seam.spawn).not.toHaveBeenCalled();
  });
});
