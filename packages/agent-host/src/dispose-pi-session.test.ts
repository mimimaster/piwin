import { describe, expect, it, vi } from 'vitest';
import { disposePiSession } from './dispose-pi-session.js';

describe('disposePiSession', () => {
  it('aborts, emits session_shutdown before dispose, and calls session.dispose', async () => {
    const order: string[] = [];
    const emit = vi.fn(async (event: { type: 'session_shutdown'; reason: 'quit' }) => {
      order.push(`emit:${event.type}:${event.reason}`);
    });
    await disposePiSession({
      abort: async () => {
        order.push('abort');
      },
      extensionRunner: {
        hasHandlers: (eventType) => eventType === 'session_shutdown',
        emit,
      },
      dispose: () => {
        order.push('dispose');
      },
    });

    expect(order).toEqual(['abort', 'emit:session_shutdown:quit', 'dispose']);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('skips emit when extensionRunner has no session_shutdown handlers', async () => {
    const emit = vi.fn(async () => undefined);
    const dispose = vi.fn();

    await disposePiSession({
      extensionRunner: {
        hasHandlers: () => false,
        emit,
      },
      dispose,
    });

    expect(emit).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('still calls dispose when abort or session_shutdown throws', async () => {
    const dispose = vi.fn();

    await disposePiSession({
      abort: async () => {
        throw new Error('abort failed');
      },
      extensionRunner: {
        hasHandlers: () => true,
        emit: async () => {
          throw new Error('shutdown handler failed');
        },
      },
      dispose,
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('bounds a hanging session_shutdown handler by timeoutMs and still disposes', async () => {
    const dispose = vi.fn();

    await disposePiSession(
      {
        extensionRunner: {
          hasHandlers: () => true,
          emit: () => new Promise(() => {}),
        },
        dispose,
      },
      { timeoutMs: 25 },
    );

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
