import { describe, expect, it, vi } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import type { InteractiveTerminalSpawn } from '@piwin/process';
import { HostTerminalRegistry, type HostTerminalOwner } from './host-terminal-registry.js';

type FakeTerminal = ReturnType<InteractiveTerminalSpawn> & {
  emit: (data: string) => void;
  exit: (code: number) => void;
  written: string[];
};

function fakeSpawn(): { spawn: InteractiveTerminalSpawn; terminals: FakeTerminal[] } {
  const terminals: FakeTerminal[] = [];
  const spawn: InteractiveTerminalSpawn = () => {
    let onData: (data: string) => void = () => undefined;
    let onExit: (event: { exitCode: number }) => void = () => undefined;
    const terminal: FakeTerminal = {
      written: [],
      write: (data: string) => { terminal.written.push(data); },
      resize: vi.fn(),
      kill: () => onExit({ exitCode: 0 }),
      onData: (listener: (data: string) => void) => { onData = listener; return { dispose: () => undefined }; },
      onExit: (listener: (event: { exitCode: number }) => void) => { onExit = listener; return { dispose: () => undefined }; },
      emit: (data: string) => onData(data),
      exit: (code: number) => onExit({ exitCode: code }),
    } as unknown as FakeTerminal;
    terminals.push(terminal);
    return terminal;
  };
  return { spawn, terminals };
}

const LAUNCH = { executable: '/bin/true', args: [], cwd: '/', cols: 80, rows: 24 };

function owner(overrides: Partial<HostTerminalOwner> = {}): HostTerminalOwner {
  return { onExit: vi.fn(), ...overrides };
}

describe('HostTerminalRegistry', () => {
  it('pushes sequenced output and keeps it for replay', async () => {
    const pushes: HostPush[] = [];
    const { spawn, terminals } = fakeSpawn();
    const registry = new HostTerminalRegistry((push) => pushes.push(push), spawn);
    const onData = vi.fn();
    const ptyId = await registry.open(LAUNCH, owner({ onData }));
    terminals[0]?.emit('hello ');
    terminals[0]?.emit('world');
    expect(pushes.map((push) => push.type === 'pty/output' ? push.sequence : null)).toEqual([1, 2]);
    expect(registry.replay(ptyId)).toEqual({ output: 'hello world', through: 2 });
    expect(onData).toHaveBeenLastCalledWith(ptyId, 'world');
  });

  it('routes client input to the owner and lets it keep a terminal on client close', async () => {
    const { spawn, terminals } = fakeSpawn();
    const registry = new HostTerminalRegistry(() => undefined, spawn);
    const onWrite = vi.fn();
    const kept = await registry.open(LAUNCH, owner({ onWrite, onClientClose: () => false }));
    const closed = await registry.open(LAUNCH, owner());
    await registry.handle({ type: 'pty/write', ptyId: kept, data: 'ls\r' }, 'r1');
    expect(terminals[0]?.written).toEqual(['ls\r']);
    expect(onWrite).toHaveBeenCalledWith(kept, 'ls\r');

    const keptOwner = owner({ onClientClose: () => false });
    expect(registry.owns(kept, keptOwner)).toBe(false);
    await registry.handle({ type: 'pty/close', ptyId: kept }, 'r2');
    await registry.handle({ type: 'pty/close', ptyId: closed }, 'r3');
    const missing = await registry.handle({ type: 'pty/write', ptyId: closed, data: 'x' }, 'r4');
    expect(missing?.success).toBe(false);
    const alive = await registry.handle({ type: 'pty/write', ptyId: kept, data: 'y' }, 'r5');
    expect(alive?.success).toBe(true);
  });

  it('reports exits to clients and to the owner', async () => {
    const pushes: HostPush[] = [];
    const { spawn, terminals } = fakeSpawn();
    const registry = new HostTerminalRegistry((push) => pushes.push(push), spawn);
    const onExit = vi.fn();
    const ptyId = await registry.open(LAUNCH, owner({ onExit }));
    terminals[0]?.exit(3);
    expect(pushes).toContainEqual({ type: 'pty/exit', ptyId, exitCode: 3 });
    expect(onExit).toHaveBeenCalledWith(ptyId, 3);
    expect(registry.replay(ptyId)).toBeUndefined();
  });

  it('ignores commands that are not terminal I/O', async () => {
    const registry = new HostTerminalRegistry(() => undefined, fakeSpawn().spawn);
    expect(await registry.handle({ type: 'host/ping' }, 'r1')).toBeNull();
  });
});
