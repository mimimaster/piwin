import { describe, expect, it, vi } from 'vitest';
import type { HostToolExecutionPort } from '@piwin/contracts';
import { normalizeGenerationToolCallId } from '../generation-identity.js';
import { toPiBackendCustomTool, projectHostToolResultToPiContent } from './pi-backend-tool-adapter.js';

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

  it('formats permission denied errors without duplicate prefix', async () => {
    const execute = vi.fn<HostToolExecutionPort['execute']>(async () => ({
      ok: false,
      code: 'permission-denied',
      message: 'Permission denied for write_file: piwin-config',
    }));
    const tool = toPiBackendCustomTool(
      {
        name: 'write_file',
        description: 'Write file',
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
      tool.execute('write-call', {}, new AbortController().signal, undefined, undefined),
    ).rejects.toMatchObject({
      name: 'PiBackendToolExecutionError',
      message: 'Permission denied for write_file: piwin-config',
    });
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

  it('projects screenshot images to Pi ImageContent without putting base64 in details', async () => {
    const execute = vi.fn<HostToolExecutionPort['execute']>(async () => ({
      ok: true as const,
      output: '{"status":"success"}',
      details: {
        attachments: [
          {
            id: 'shot-1',
            kind: 'media' as const,
            path: '/tmp/media/shot.jpg',
            mimeType: 'image/jpeg',
            byteSize: 4,
            source: 'generated' as const,
          },
        ],
      },
      images: [{ mimeType: 'image/jpeg', dataBase64: '/9j/AAAA' }],
    }));
    const tool = toPiBackendCustomTool(
      {
        name: 'browser_screenshot',
        description: 'Screenshot',
        parameters: { type: 'object', properties: {} },
      },
      { execute },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        getRunId: () => 'run-1',
      },
    );

    const result = await tool.execute(
      'shot-call',
      {},
      new AbortController().signal,
      undefined,
      undefined,
    );

    expect(result.content).toEqual([
      { type: 'text', text: '{"status":"success"}' },
      { type: 'image', mimeType: 'image/jpeg', data: '/9j/AAAA' },
    ]);
    expect(result.details.attachments).toEqual([
      expect.objectContaining({ id: 'shot-1', path: '/tmp/media/shot.jpg' }),
    ]);
    expect(JSON.stringify(result.details)).not.toContain('/9j/AAAA');
  });

  it('leaves text-only tool results unchanged', async () => {
    const execute = vi.fn<HostToolExecutionPort['execute']>(async () => ({
      ok: true as const,
      output: 'grep hits',
    }));
    const tool = toPiBackendCustomTool(
      {
        name: 'grep',
        description: 'Grep',
        parameters: { type: 'object', properties: {} },
      },
      { execute },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        getRunId: () => 'run-1',
      },
    );
    const result = await tool.execute(
      'grep-call',
      {},
      new AbortController().signal,
      undefined,
      undefined,
    );
    expect(result.content).toEqual([{ type: 'text', text: 'grep hits' }]);
  });
});

describe('projectHostToolResultToPiContent', () => {
  it('drops data-URL payloads so they cannot leak into Pi image parts', () => {
    const projected = projectHostToolResultToPiContent({
      ok: true,
      output: 'ok',
      images: [{ mimeType: 'image/jpeg', dataBase64: 'data:image/jpeg;base64,AAAA' }],
    });
    expect(projected.content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});
