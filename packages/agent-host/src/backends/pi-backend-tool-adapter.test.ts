import { describe, expect, it, vi } from 'vitest';
import type { HostToolExecutionPort } from '@piwin/contracts';
import { normalizeGenerationToolCallId } from '../generation-identity.js';
import { toPiBackendCustomTool } from './pi-backend-tool-adapter.js';

describe('toPiBackendCustomTool invocation identity', () => {
  it('forwards the same generation-normalized tool id used by Agent events', async () => {
    const execute = vi.fn<HostToolExecutionPort['execute']>(async () => ({
      ok: true,
      output: 'ok',
    }));
    const tool = toPiBackendCustomTool(
      {
        name: 'piwin_subagent_run',
        description: 'Delegate',
        parameters: { type: 'object', properties: {} },
      },
      { execute },
      {
        sessionId: 'parent-session',
        runtimeGenerationId: 'generation-1',
        getRunId: () => 'parent-run',
      },
    );

    await tool.execute(
      'backend-tool-call',
      { task: 'inspect' },
      new AbortController().signal,
      undefined,
      undefined,
    );

    expect(execute).toHaveBeenCalledWith(
      {
        sessionId: 'parent-session',
        runtimeGenerationId: 'generation-1',
        runId: 'parent-run',
        toolCallId: normalizeGenerationToolCallId(
          { sessionId: 'parent-session', runtimeGenerationId: 'generation-1' },
          'backend-tool-call',
        ),
        toolName: 'piwin_subagent_run',
        arguments: { task: 'inspect' },
      },
      expect.any(AbortSignal),
    );
  });

  it('throws Host failures so Pi emits an error lifecycle event', async () => {
    const execute = vi.fn<HostToolExecutionPort['execute']>(async () => ({
      ok: false,
      code: 'execution-failed',
      message: 'provider returned HTTP 400',
    }));
    const tool = toPiBackendCustomTool(
      {
        name: 'video_gen',
        description: 'Generate video',
        parameters: { type: 'object', properties: {} },
      },
      { execute },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        getRunId: () => 'run-1',
      },
    );

    await expect(
      tool.execute('video-call', {}, new AbortController().signal, undefined, undefined),
    ).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      message: 'Tool error (execution-failed): provider returned HTTP 400',
    });
  });
});
