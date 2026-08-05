import { describe, it, expect, vi } from 'vitest';
import { createSubagentRunTool } from './subagent-run-tool.js';

type SpawnCall = {
  parentSessionId: string;
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
  const spawn = overrides?.spawn ?? vi.fn(async () => ({ childSessionId: 'child-1' }));
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

describe('createSubagentRunTool', () => {
  it('has correct tool name and required parameters', () => {
    const tool = createSubagentRunTool({
      sessionId: 's1',
      seam: fakeSeam(),
    });
    expect(tool.name).toBe('piwin_subagent_run');
    expect(tool.parameters.required).toEqual(['task']);
    expect(tool.parameters.properties).toHaveProperty('task');
    expect(tool.parameters.properties).toHaveProperty('mode');
    expect(tool.parameters.properties).toHaveProperty('sessionName');
  });

  it('spawns, merges, and returns summary on success', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 'parent-1', seam });
    const result = await tool.execute({ task: 'explore the auth module' });
    expect(seam.spawn).toHaveBeenCalledTimes(1);
    expect(firstSpawnArg(seam)).toEqual({
      parentSessionId: 'parent-1',
      task: 'explore the auth module',
      mode: 'readonly',
    });
    expect(seam.merge).toHaveBeenCalledTimes(1);
    expect(result).toContain('subagent completed');
    expect(result).toContain('did the thing');
    expect(result).toContain('childSessionId=child-1');
  });

  it('defaults to readonly mode', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await tool.execute({ task: 'test' });
    expect(firstSpawnArg(seam).mode).toBe('readonly');
  });

  it('lets a selected profile provide isolation when mode is omitted', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await tool.execute({ task: 'implement the change', profileId: 'implementer' });
    expect(firstSpawnArg(seam).profileId).toBe('implementer');
    expect(firstSpawnArg(seam).mode).toBeUndefined();
  });

  it('passes worktree mode through', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await tool.execute({ task: 'test', mode: 'worktree' });
    expect(firstSpawnArg(seam).mode).toBe('worktree');
  });

  it('passes sessionName through when provided', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await tool.execute({ task: 'test', sessionName: 'explorer-1' });
    expect(firstSpawnArg(seam).sessionName).toBe('explorer-1');
  });

  it('omits sessionName when not provided', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await tool.execute({ task: 'test' });
    expect(firstSpawnArg(seam).sessionName).toBeUndefined();
  });

  it('forwards applyPolicy to spawn when provided', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 'parent-1', seam });
    await tool.execute({ task: 't', mode: 'worktree', applyPolicy: 'auto' });
    expect(firstSpawnArg(seam).applyPolicy).toBe('auto');
  });

  it('forwards explicit applyPolicy with allowed paths intent', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 'parent-1', seam });
    await tool.execute({ task: 't', mode: 'worktree', applyPolicy: 'explicit' });
    expect(firstSpawnArg(seam).applyPolicy).toBe('explicit');
  });

  it('omits applyPolicy when none or invalid', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    await tool.execute({ task: 'test' });
    expect(firstSpawnArg(seam).applyPolicy).toBeUndefined();
    await tool.execute({ task: 'test', applyPolicy: 'bogus' });
    expect(firstSpawnArg(seam).applyPolicy).toBeUndefined();
  });

  it('declares applyPolicy in the tool schema', () => {
    const tool = createSubagentRunTool({ sessionId: 's1', seam: fakeSeam() });
    const properties = tool.parameters.properties as Record<string, { enum?: string[] }>;
    expect(properties).toHaveProperty('applyPolicy');
    expect(properties.applyPolicy?.enum).toEqual(['none', 'auto', 'explicit']);
  });

  it('rejects empty task', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await tool.execute({ task: '' });
    expect(result).toBe('error: task is required');
    expect(seam.spawn).not.toHaveBeenCalled();
  });

  it('rejects invalid mode', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await tool.execute({ task: 'test', mode: 'sandbox' });
    expect(result).toContain('error: invalid mode');
    expect(seam.spawn).not.toHaveBeenCalled();
  });

  it('returns error when spawn throws', async () => {
    const seam = fakeSeam({
      spawn: vi.fn(async () => {
        throw new Error('depth max exceeded');
      }),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await tool.execute({ task: 'test' });
    expect(result).toContain('error: subagent spawn failed');
    expect(result).toContain('depth max exceeded');
    expect(seam.merge).not.toHaveBeenCalled();
  });

  it('returns error when merge throws', async () => {
    const seam = fakeSeam({
      merge: vi.fn(async () => {
        throw new Error('unknown child');
      }),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await tool.execute({ task: 'test' });
    expect(result).toContain('error: subagent merge failed');
    expect(result).toContain('unknown child');
  });

  it('handles alreadyMerged from merge seam', async () => {
    const seam = fakeSeam({
      merge: vi.fn(async () => ({
        summaryPreview: 'cached summary',
        alreadyMerged: true,
      })),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await tool.execute({ task: 'test' });
    expect(result).toContain('summary from prior merge');
    expect(result).toContain('cached summary');
  });

  it('handles missing summaryPreview gracefully', async () => {
    const seam = fakeSeam({
      merge: vi.fn(async () => ({})),
    });
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const result = await tool.execute({ task: 'test' });
    expect(result).toContain('(no summary)');
  });

  it('respects abort signal before spawn', async () => {
    const seam = fakeSeam();
    const tool = createSubagentRunTool({ sessionId: 's1', seam });
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute({ task: 'test' }, controller.signal);
    expect(result).toContain('error: aborted before spawn');
    expect(seam.spawn).not.toHaveBeenCalled();
  });
});
