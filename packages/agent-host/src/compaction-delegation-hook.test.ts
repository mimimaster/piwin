import { describe, expect, it, vi } from 'vitest';
import type { CompactionDelegationTarget } from '@piwin/contracts';
import {
  COMPACTION_DELEGATION_EXTENSION_PATH,
  createCompactionDelegationState,
  installCompactionDelegationHook,
  type CompactionModelRuntime,
} from './compaction-delegation-hook.js';
import { prioritizeCompactionHooks } from './compaction-hook-priority.js';
import type { PiModelRegistration } from './pi-model-runtime.js';

const delegateModelSpec: PiModelRegistration = {
  id: 'delegate-mini',
  name: 'Delegate Mini',
  api: 'openai-completions',
  baseUrl: 'https://delegate.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 64_000,
  maxTokens: 4_096,
};

const delegation: CompactionDelegationTarget = {
  model: {
    protocol: 'openai-compatible',
    providerId: 'delegate-provider',
    modelId: 'delegate-mini',
  },
};

function makeFakeLoader(initialPaths: string[]) {
  const loaded = {
    extensions: initialPaths.map((extPath) => ({
      path: extPath,
      resolvedPath: extPath,
      handlers: new Map<string, Array<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>>>(),
      tools: new Map(),
      messageRenderers: new Map(),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    })),
  };
  return {
    loaded,
    resourceLoader: {
      getExtensions: () => loaded,
    },
  };
}

describe('installCompactionDelegationHook', () => {
  it('returns false when resourceLoader exposes no extensions array', () => {
    const state = createCompactionDelegationState();
    expect(
      installCompactionDelegationHook({
        resourceLoader: {},
        delegation,
        getModelRuntime: () => undefined,
        state,
      }),
    ).toBe(false);
  });

  it('prepends compaction delegation ahead of pi-deepseek-cache and deduplicates on reinstall', async () => {
    const callOrder: string[] = [];
    const { loaded, resourceLoader } = makeFakeLoader([
      '/ext/community-a/index.ts',
      '/bundled/pi-deepseek-cache/index.ts',
    ]);
    const communityHandler = vi.fn(async () => {
      callOrder.push('community');
      return { cancel: true };
    });
    const deepseekHandler = vi.fn(async () => {
      callOrder.push('deepseek');
      return { cancel: true };
    });
    loaded.extensions[0]?.handlers.set('session_before_compact', [communityHandler]);
    loaded.extensions[1]?.handlers.set('session_before_compact', [deepseekHandler]);
    const state = createCompactionDelegationState();

    expect(
      installCompactionDelegationHook({
        resourceLoader,
        delegation,
        getModelRuntime: () => undefined,
        state,
      }),
    ).toBe(true);
    expect(
      installCompactionDelegationHook({
        resourceLoader,
        delegation,
        getModelRuntime: () => undefined,
        state,
      }),
    ).toBe(true);

    expect(loaded.extensions.map((ext) => ext.path)).toEqual([
      COMPACTION_DELEGATION_EXTENSION_PATH,
      '/ext/community-a/index.ts',
      '/bundled/pi-deepseek-cache/index.ts',
    ]);

    prioritizeCompactionHooks(resourceLoader, [
      COMPACTION_DELEGATION_EXTENSION_PATH,
      '/bundled/pi-deepseek-cache/index.ts',
    ]);
    const chainedHandler = loaded.extensions[0]?.handlers.get('session_before_compact')?.[0];
    if (!chainedHandler) throw new Error('expected chained session_before_compact handler');
    const result = await chainedHandler({ preparation: {} }, {});
    expect(result).toEqual({ cancel: true });
    // Delegation ran first and blocked fallback before pi-deepseek-cache or community hooks ran.
    expect(callOrder).toEqual([]);
    expect(deepseekHandler).not.toHaveBeenCalled();
    expect(communityHandler).not.toHaveBeenCalled();
  });

  it('routes compaction through the delegated model, resolves headers/env, and binds streamSimple', async () => {
    const { loaded, resourceLoader } = makeFakeLoader([]);
    const state = createCompactionDelegationState();
    const compactSpy = vi.fn(async () => ({
      summary: 'delegated summary',
      tokensBefore: 1200,
    }));
    const streamSimpleSpy = vi.fn(function (this: unknown) {
      return { boundThis: this };
    });
    const runtime: CompactionModelRuntime = {
      registerProvider: vi.fn(),
      getModel: vi.fn((provider, model) =>
        provider === 'delegate-provider' && model === 'delegate-mini' ? delegateModelSpec : undefined,
      ),
      refresh: vi.fn(async () => undefined),
      streamSimple: streamSimpleSpy,
    };

    installCompactionDelegationHook({
      resourceLoader,
      delegation,
      getModelRuntime: () => runtime,
      getRetrySettings: () => ({ maxRetries: 2 }),
      piModule: { compact: compactSpy },
      state,
    });

    const handler = loaded.extensions[0]?.handlers.get('session_before_compact')?.[0];
    if (!handler) throw new Error('expected handler');

    const getApiKeyAndHeaders = vi.fn(async () => ({
      ok: true as const,
      apiKey: 'secret-token',
      headers: { 'X-Custom': 'yes', 'X-Remove': null } as unknown as Record<string, string>,
      baseUrl: 'https://override.delegate.invalid/v1',
      env: { EXTRA_ENV: '1' },
    }));

    const preparation = { tokensBefore: 1200, messagesToSummarize: [] };
    const signal = new AbortController().signal;
    const outcome = await handler(
      { preparation, customInstructions: 'Focus on edits', signal },
      { thinkingLevel: 'low', modelRegistry: { getApiKeyAndHeaders } },
    );

    expect(outcome).toEqual({ compaction: { summary: 'delegated summary', tokensBefore: 1200 } });
    expect(compactSpy).toHaveBeenCalledTimes(1);
    const call = compactSpy.mock.calls[0] as unknown[];
    expect(call[0]).toBe(preparation);
    expect(call[1]).toEqual({
      ...delegateModelSpec,
      baseUrl: 'https://override.delegate.invalid/v1',
    });
    expect(call[2]).toBe('secret-token');
    expect(call[3]).toEqual({ 'X-Custom': 'yes' });
    expect(call[4]).toBe('Focus on edits');
    expect(call[5]).toBe(signal);
    expect(call[6]).toBe('low');
    expect(typeof call[7]).toBe('function');
    const streamResult = (call[7] as (m: unknown, c: unknown, o: unknown) => unknown)({}, {}, {});
    expect(streamResult).toEqual({ boundThis: runtime });
    expect(call[8]).toEqual({ EXTRA_ENV: '1' });
    expect(call[9]).toEqual({ maxRetries: 2 });
  });

  it('falls back to runtime.getAuth and works cleanly for keyless local providers', async () => {
    const { loaded, resourceLoader } = makeFakeLoader([]);
    const state = createCompactionDelegationState();
    const compactSpy = vi.fn(async (..._args: unknown[]) => ({
      summary: 'local ok',
      tokensBefore: 500,
    }));
    const runtime: CompactionModelRuntime = {
      registerProvider: vi.fn(),
      getModel: vi.fn(() => undefined),
      refresh: vi.fn(async () => undefined),
      getAuth: vi.fn(async () => undefined),
    };

    installCompactionDelegationHook({
      resourceLoader,
      delegation,
      getModelRuntime: () => runtime,
      piModule: { compact: compactSpy },
      state,
    });

    const handler = loaded.extensions[0]?.handlers.get('session_before_compact')?.[0];
    if (!handler) throw new Error('expected handler');
    const outcome = await handler(
      { preparation: {} },
      { modelRegistry: { find: () => delegateModelSpec } },
    );
    expect(outcome).toEqual({ compaction: { summary: 'local ok', tokensBefore: 500 } });
    expect(compactSpy.mock.calls[0]?.[2]).toBeUndefined();
    expect(compactSpy.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('records explicit failure and cancels default compact when delegated model is unavailable or errors', async () => {
    const { loaded, resourceLoader } = makeFakeLoader([]);
    const state = createCompactionDelegationState();
    installCompactionDelegationHook({
      resourceLoader,
      delegation,
      getModelRuntime: () => ({
        registerProvider: vi.fn(),
        getModel: vi.fn(() => undefined),
        refresh: vi.fn(async () => undefined),
      }),
      state,
    });

    const handler = loaded.extensions[0]?.handlers.get('session_before_compact')?.[0];
    if (!handler) throw new Error('expected handler');

    const result = await handler({ preparation: {} }, {});
    expect(result).toEqual({ cancel: true });

    expect(
      state.transformEvent({ type: 'compaction_end', aborted: true, willRetry: false }),
    ).toEqual({
      type: 'compaction_end',
      aborted: false,
      willRetry: false,
      errorMessage: expect.stringContaining(
        'Compaction delegation failed (delegate-provider/delegate-mini)',
      ),
    });

    await expect(
      state.runCompact(async () => {
        throw new Error('Compaction cancelled');
      }),
    ).rejects.toThrow(/Compaction delegation failed \(delegate-provider\/delegate-mini\)/);

    expect(state.transformEvent({ type: 'compaction_start' })).toEqual({
      type: 'compaction_start',
    });
    expect(state.consume()).toBeUndefined();
  });

  it('preserves user abort cancellations without turning them into delegation failures', async () => {
    const { loaded, resourceLoader } = makeFakeLoader([]);
    const state = createCompactionDelegationState();
    const controller = new AbortController();
    const compactSpy = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });

    installCompactionDelegationHook({
      resourceLoader,
      delegation,
      getModelRuntime: () => ({
        registerProvider: vi.fn(),
        getModel: vi.fn(() => delegateModelSpec),
        refresh: vi.fn(async () => undefined),
      }),
      piModule: { compact: compactSpy },
      state,
    });

    const handler = loaded.extensions[0]?.handlers.get('session_before_compact')?.[0];
    if (!handler) throw new Error('expected handler');
    const result = await handler(
      { preparation: {}, signal: controller.signal },
      { modelRegistry: {} },
    );
    expect(result).toEqual({ cancel: true });
    expect(state.consume()).toBeUndefined();
    expect(state.transformEvent({ type: 'compaction_end', aborted: true })).toEqual({
      type: 'compaction_end',
      aborted: true,
    });
  });
});
