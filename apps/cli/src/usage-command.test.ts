import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandUsage } from './usage-command.js';
import { openCliHost } from './cli-host.js';

vi.mock('./cli-host.js', () => ({ openCliHost: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe('usage CLI model selection', () => {
  it('sends the exact model id to the Host and includes it in the output', async () => {
    const handleCommand = vi.fn(async () => ({ success: true, data: { rollup: {
      scope: { kind: 'global' }, promptTokens: 60, completionTokens: 40, cacheReadTokens: 0,
      cacheWriteTokens: 0, totalTokens: 100, sessionCount: 1, entryCount: 1,
      firstAt: null, lastAt: null, byModelKey: [], bySession: [],
    } } }));
    const dispose = vi.fn(async () => undefined);
    vi.mocked(openCliHost).mockResolvedValue({ handleCommand, dispose } as unknown as Awaited<ReturnType<typeof openCliHost>>);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await commandUsage(['--global', '--model', 'route/model']);
    expect(handleCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'usage/get-rollup', modelId: 'route/model' }));
    expect(output).toHaveBeenCalledWith(expect.stringContaining('route/model'));
  });
  it('rejects a missing model value', async () => {
    await expect(commandUsage(['--model'])).rejects.toThrow('--model requires a model id');
  });
});
