import { describe, expect, it, vi } from 'vitest';
import {
  createStalledStreamFailure,
  isOpenAiCompletionsStreamProtocol,
  readPiHttpIdleTimeoutMs,
  runPiPromptWithParsedStreamGuard,
  runTrackedGuardedPiPrompt,
} from './pi-parsed-stream-guard.js';

describe('pi-parsed-stream-guard', () => {
  it('reads Pi httpIdleTimeoutMs and treats 0 as disabled', () => {
    expect(readPiHttpIdleTimeoutMs({ getHttpIdleTimeoutMs: () => 180_000 })).toBe(180_000);
    expect(readPiHttpIdleTimeoutMs({ getHttpIdleTimeoutMs: () => 0 })).toBe(0);
    expect(readPiHttpIdleTimeoutMs({})).toBe(300_000);
    expect(isOpenAiCompletionsStreamProtocol('openai-completions')).toBe(true);
    expect(isOpenAiCompletionsStreamProtocol('openai-compatible')).toBe(true);
    expect(isOpenAiCompletionsStreamProtocol('anthropic-messages')).toBe(false);
    expect(isOpenAiCompletionsStreamProtocol('google-generative-ai')).toBe(false);
  });

  it('does not wrap Anthropic or a zero timeout', async () => {
    const abort = vi.fn(async () => undefined);
    const result = await runPiPromptWithParsedStreamGuard({
      enabled: false,
      timeoutMs: 20,
      prompt: async () => undefined,
      abort,
      subscribe: () => () => undefined,
    });
    expect(result).toEqual({ stalled: false });
    expect(abort).not.toHaveBeenCalled();
  });

  it('resets the deadline on assistant updates and ignores keep-alive silence until it fires', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const abort = vi.fn(async () => {
      resolvePrompt?.();
    });
    const pending = runPiPromptWithParsedStreamGuard({
      enabled: true,
      timeoutMs: 100,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort,
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });

    listener?.({ type: 'message_start', role: 'assistant' });
    await vi.advanceTimersByTimeAsync(90);
    listener?.({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'a' },
    });
    await vi.advanceTimersByTimeAsync(90);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(abort).toHaveBeenCalledTimes(1);
    expect(result.stalled).toBe(true);
    vi.useRealTimers();
  });

  it('does not arm on user or tool-result lifecycle or long tool execution', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const abort = vi.fn(async () => undefined);
    const pending = runPiPromptWithParsedStreamGuard({
      enabled: true,
      timeoutMs: 50,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort,
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });

    listener?.({ type: 'message_start', role: 'user' });
    await vi.advanceTimersByTimeAsync(80);
    listener?.({ type: 'message_start', message: { role: 'toolResult' } });
    await vi.advanceTimersByTimeAsync(80);
    listener?.({ type: 'message_start', role: 'assistant' });
    listener?.({ type: 'message_end' });
    listener?.({ type: 'tool_execution_start', toolName: 'read' });
    await vi.advanceTimersByTimeAsync(200);
    expect(abort).not.toHaveBeenCalled();
    resolvePrompt?.();
    await expect(pending).resolves.toEqual({ stalled: false });
    vi.useRealTimers();
  });

  it('leaves header/connect idle to Pi when no assistant message starts', async () => {
    vi.useFakeTimers();
    const abort = vi.fn(async () => undefined);
    let resolvePrompt: (() => void) | undefined;
    const pending = runPiPromptWithParsedStreamGuard({
      enabled: true,
      timeoutMs: 40,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort,
      subscribe: () => () => undefined,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(abort).not.toHaveBeenCalled();
    resolvePrompt?.();
    await expect(pending).resolves.toEqual({ stalled: false });
    vi.useRealTimers();
  });

  it('waits for abort settlement before returning stalled', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    let resolveAbort: (() => void) | undefined;
    const pending = runPiPromptWithParsedStreamGuard({
      enabled: true,
      timeoutMs: 20,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort: () =>
        new Promise<void>((resolve) => {
          resolveAbort = resolve;
        }),
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    listener?.({ type: 'message_start' });
    await vi.advanceTimersByTimeAsync(20);
    expect(resolveAbort).toBeTypeOf('function');
    resolvePrompt?.();
    resolveAbort?.();
    await expect(pending).resolves.toEqual({ stalled: true });
    vi.useRealTimers();
  });

  it('logs abort failure and still returns the stall as the primary failure', async () => {
    vi.useFakeTimers();
    const logger = { error: vi.fn() };
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const pending = runTrackedGuardedPiPrompt({
      enabled: true,
      timeoutMs: 20,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort: async () => {
        resolvePrompt?.();
        throw new Error('abort exploded');
      },
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
      logger,
    });
    listener?.({ type: 'message_start' });
    await vi.advanceTimersByTimeAsync(20);
    const outcome = await pending;
    expect(logger.error).toHaveBeenCalledWith(
      'parsed-stream guard abort failed',
      expect.any(Error),
    );
    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'model-stream-stalled',
        origin: 'transport',
        retriable: true,
      },
    });
    if (outcome.status === 'failed') {
      expect(outcome.failure.message).toContain('Abort failed: abort exploded');
    }
    vi.useRealTimers();
  });

  it('returns a failed stall outcome after settlement instead of rejecting', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const outcomePromise = runTrackedGuardedPiPrompt({
      enabled: true,
      timeoutMs: 20,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort: async () => {
        resolvePrompt?.();
      },
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    listener?.({ type: 'agent_start' });
    listener?.({ type: 'message_start' });
    await vi.advanceTimersByTimeAsync(20);
    await expect(outcomePromise).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'model-stream-stalled' },
    });
    vi.useRealTimers();
  });

  it('lets the next prompt start after a stall has settled', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const first = runTrackedGuardedPiPrompt({
      enabled: true,
      timeoutMs: 20,
      prompt: () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
      abort: async () => {
        resolvePrompt?.();
      },
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    listener?.({ type: 'message_start' });
    await vi.advanceTimersByTimeAsync(20);
    await first;
    vi.useRealTimers();

    await expect(
      runTrackedGuardedPiPrompt({
        enabled: true,
        timeoutMs: 0,
        prompt: async () => undefined,
        abort: async () => undefined,
        subscribe: () => () => undefined,
      }),
    ).resolves.toMatchObject({ status: 'completed', stopReason: 'handled' });
  });
});
