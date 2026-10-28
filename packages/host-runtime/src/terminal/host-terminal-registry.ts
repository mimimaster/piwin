/**
 * The Host's interactive terminals (native agent CLIs, the Host-run TUI).
 *
 * One `InteractiveTerminalManager` and one terminal limit for every owner.
 * Bytes go out as `pty/output` with a per-terminal sequence; client
 * `pty/write | resize | close` are routed here by ptyId, and each owner decides
 * what its terminals do on input, client close and exit.
 */
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import {
  InteractiveTerminalManager,
  type InteractiveTerminalInput,
  type InteractiveTerminalSpawn,
} from '@piwin/process';
import { NativeCliOutputBuffer } from '../grok/native-cli-output.js';
import { fail, ok } from '../response-helpers.js';

export type HostTerminalOwner = {
  /** Output already pushed to clients; owners may watch it (session announcements). */
  onData?: (ptyId: string, data: string) => void;
  /** Client input already written to the terminal. */
  onWrite?: (ptyId: string, data: string) => void;
  /**
   * A client hid the terminal. Return false to keep the process running
   * (a native agent keeps the writer until an explicit sync).
   */
  onClientClose?: (ptyId: string) => boolean;
  onExit: (ptyId: string, exitCode: number) => void;
};

type TerminalSlot = { owner: HostTerminalOwner; output: NativeCliOutputBuffer };

export type HostTerminalReplay = { output: string; through: number };

export class HostTerminalRegistry {
  private readonly terminals: InteractiveTerminalManager;
  private readonly slots = new Map<string, TerminalSlot>();
  /** Output that arrives before `open` resolves still needs a sequence and replay. */
  private readonly early = new Map<string, NativeCliOutputBuffer>();

  public constructor(
    private readonly push: (push: HostPush) => void,
    /** Fake PTY factory for unit tests — production omits this. */
    spawnTerminal?: InteractiveTerminalSpawn,
  ) {
    this.terminals = new InteractiveTerminalManager({
      ...(spawnTerminal === undefined ? {} : { spawnTerminal }),
      onData: (ptyId, data) => this.receive(ptyId, data),
      onExit: (ptyId, exitCode) => {
        const slot = this.slots.get(ptyId);
        this.slots.delete(ptyId);
        this.early.delete(ptyId);
        this.push({ type: 'pty/exit', ptyId, exitCode });
        slot?.owner.onExit(ptyId, exitCode);
      },
    });
  }

  public async open(input: InteractiveTerminalInput, owner: HostTerminalOwner): Promise<string> {
    const ptyId = await this.terminals.open(input);
    const output = this.early.get(ptyId) ?? new NativeCliOutputBuffer();
    this.early.delete(ptyId);
    this.slots.set(ptyId, { owner, output });
    return ptyId;
  }

  public owns(ptyId: string, owner: HostTerminalOwner): boolean {
    return this.slots.get(ptyId)?.owner === owner;
  }

  public replay(ptyId: string): HostTerminalReplay | undefined {
    const output = this.slots.get(ptyId)?.output;
    if (output === undefined) return undefined;
    const text = output.read().join('');
    return text.length === 0 ? undefined : { output: text, through: output.getSequence() };
  }

  public write(ptyId: string, data: string): void {
    this.terminals.write(ptyId, data);
    this.slots.get(ptyId)?.owner.onWrite?.(ptyId, data);
  }

  public resize(ptyId: string, cols: number, rows: number): void {
    this.terminals.resize(ptyId, cols, rows);
  }

  /** Owner-initiated close: always ends the process. */
  public close(ptyId: string): Promise<void> {
    return this.terminals.close(ptyId);
  }

  public async handle(command: HostCommand, requestId: string | undefined): Promise<HostResponse | null> {
    try {
      switch (command.type) {
        case 'pty/write':
          this.write(command.ptyId, command.data);
          return ok(requestId, command.type, {});
        case 'pty/resize':
          this.resize(command.ptyId, command.cols, command.rows);
          return ok(requestId, command.type, {});
        case 'pty/close': {
          const slot = this.slots.get(command.ptyId);
          if (slot?.owner.onClientClose?.(command.ptyId) !== false) {
            await this.terminals.close(command.ptyId);
          }
          return ok(requestId, command.type, {});
        }
        default:
          return null;
      }
    } catch (error) {
      return fail(requestId, command.type, formatError(error));
    }
  }

  public dispose(): Promise<void> {
    return this.terminals.dispose();
  }

  private receive(ptyId: string, data: string): void {
    const slot = this.slots.get(ptyId);
    let output = slot?.output ?? this.early.get(ptyId);
    if (output === undefined) {
      output = new NativeCliOutputBuffer();
      this.early.set(ptyId, output);
    }
    output.append(data);
    this.push({ type: 'pty/output', ptyId, data, at: new Date().toISOString(), sequence: output.getSequence() });
    slot?.owner.onData?.(ptyId, data);
  }
}

/** One registry per Host, created on first use. */
export function hostTerminals(deps: {
  hostTerminals: HostTerminalRegistry | undefined;
  push: (push: HostPush) => void;
}): HostTerminalRegistry {
  deps.hostTerminals ??= new HostTerminalRegistry((push) => deps.push(push));
  return deps.hostTerminals;
}

export async function handleHostTerminalCommand(
  deps: Parameters<typeof hostTerminals>[0],
  command: HostCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  if (command.type !== 'pty/write' && command.type !== 'pty/resize' && command.type !== 'pty/close') {
    return null;
  }
  return hostTerminals(deps).handle(command, requestId);
}
