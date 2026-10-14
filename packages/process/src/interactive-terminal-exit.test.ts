import { describe, expect, it, vi } from 'vitest';
import { InteractiveTerminalError, InteractiveTerminalManager } from './interactive-terminal.js';

describe('InteractiveTerminalManager exit confirmation (fake PTY)', () => {
  it('awaits onExit after SIGKILL before releasing the entry', async () => {
    vi.useFakeTimers();
    const exits: number[] = [];
    let exitHandler: ((event: { exitCode: number }) => void) | undefined;
    const kill = vi.fn((signal?: string) => {
      if (signal === 'SIGKILL') {
        queueMicrotask(() => exitHandler?.({ exitCode: 9 }));
      }
    });
    const manager = new InteractiveTerminalManager({
      onData: () => undefined,
      onExit: (_id, code) => exits.push(code),
      spawnTerminal: () => ({
        write: vi.fn(),
        resize: vi.fn(),
        kill,
        onData: vi.fn(),
        onExit: (handler) => {
          exitHandler = handler as (event: { exitCode: number }) => void;
          return { dispose: () => undefined };
        },
      }),
    });

    const id = await manager.open({
      executable: '/bin/fake',
      args: ['--resume', 'native-1'],
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    });
    const closing = manager.close(id);
    await vi.advanceTimersByTimeAsync(2500);
    await closing;
    expect(kill).toHaveBeenCalledWith();
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(exits).toEqual([9]);
    expect(() => manager.write(id, 'x')).toThrow(/terminal-not-found/);
    vi.useRealTimers();
  });

  it('retains the entry and throws when exit never arrives after SIGKILL', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const manager = new InteractiveTerminalManager({
      onData: () => undefined,
      onExit: () => undefined,
      spawnTerminal: () => ({
        write: vi.fn(),
        resize: vi.fn(),
        kill,
        onData: vi.fn(),
        onExit: vi.fn(() => ({ dispose: () => undefined })),
      }),
    });
    const id = await manager.open({
      executable: '/bin/fake',
      args: ['x'],
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    });
    const closing = manager.close(id);
    const expectation = expect(closing).rejects.toBeInstanceOf(InteractiveTerminalError);
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;
    // Entry retained for retry — write still addresses the same slot.
    expect(() => manager.write(id, 'still-here')).not.toThrow();
    vi.useRealTimers();
  });
});
