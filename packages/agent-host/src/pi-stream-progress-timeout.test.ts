import { describe, expect, it, vi } from 'vitest';
import {
  PiStreamProgressTimeoutError,
  readPiHttpIdleTimeoutMs,
  runPiPromptWithProgressTimeout,
} from './pi-stream-progress-timeout.js';

describe('Pi stream progress timeout', () => {
  it('uses the native Pi HTTP idle timeout setting', () => {
    expect(readPiHttpIdleTimeoutMs({ getHttpIdleTimeoutMs: () => 180_000 })).toBe(180_000);
    expect(readPiHttpIdleTimeoutMs({ getHttpIdleTimeoutMs: () => 0 })).toBe(0);
    expect(readPiHttpIdleTimeoutMs({})).toBe(300_000);
  });

  it('times out only after a native assistant message starts streaming', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    const abort = vi.fn(async () => undefined);
    const pendingPrompt = new Promise<void>(() => undefined);
    const result = runPiPromptWithProgressTimeout({
      timeoutMs: 100,
      prompt: () => pendingPrompt,
      abort,
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const rejection = expect(result).rejects.toBeInstanceOf(PiStreamProgressTimeoutError);

    await vi.advanceTimersByTimeAsync(200);
    expect(abort).not.toHaveBeenCalled();

    listener?.({ type: 'message_start' });
    await vi.advanceTimersByTimeAsync(99);
    listener?.({ type: 'message_update' });
    await vi.advanceTimersByTimeAsync(99);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(abort).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('disarms while Pi executes tools after message_end', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const prompt = new Promise<void>((resolve) => {
      resolvePrompt = resolve;
    });
    const abort = vi.fn(async () => undefined);
    const result = runPiPromptWithProgressTimeout({
      timeoutMs: 100,
      prompt: () => prompt,
      abort,
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });

    listener?.({ type: 'message_start' });
    listener?.({ type: 'message_end' });
    await vi.advanceTimersByTimeAsync(500);
    expect(abort).not.toHaveBeenCalled();
    resolvePrompt?.();
    await result;
    vi.useRealTimers();
  });
});
