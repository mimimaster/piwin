import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import { AGENT_CLI_MAX_INPUT_CHARS, isValidTerminalSize } from '@piwin/contracts';

export type InteractiveTerminalInput = {
  executable: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
};

export class InteractiveTerminalError extends Error {
  public override readonly name = 'InteractiveTerminalError';
}

type TerminalEntry = { terminal: IPty; exited: Promise<void>; closing?: Promise<void> };

/** Owns OS terminals; agent/session policy is injected by host-runtime. */
export class InteractiveTerminalManager {
  private readonly entries = new Map<string, TerminalEntry>();

  public constructor(private readonly events: {
    onData: (ptyId: string, data: string) => void;
    onExit: (ptyId: string, exitCode: number) => void;
  }) {}

  public async open(input: InteractiveTerminalInput): Promise<string> {
    if (!isValidTerminalSize(input.cols, input.rows)) throw new InteractiveTerminalError('invalid-terminal-size');
    if (this.entries.size >= 8) throw new InteractiveTerminalError('terminal-limit: close an existing terminal');
    const { spawn } = await import('node-pty');
    // Another open may have completed while the native module loaded.
    if (this.entries.size >= 8) throw new InteractiveTerminalError('terminal-limit: close an existing terminal');
    const terminal = spawn(input.executable, input.args, {
      name: 'xterm-256color', cwd: input.cwd, cols: input.cols, rows: input.rows,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    const ptyId = randomUUID();
    let finish: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => { finish = resolve; });
    this.entries.set(ptyId, { terminal, exited });
    terminal.onData((data) => {
      // Bound wire frames without cutting a Unicode surrogate pair in half.
      let offset = 0;
      while (offset < data.length) {
        let end = Math.min(offset + AGENT_CLI_MAX_INPUT_CHARS, data.length);
        const last = data.charCodeAt(end - 1);
        if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
        this.events.onData(ptyId, data.slice(offset, end));
        offset = end;
      }
    });
    terminal.onExit(({ exitCode }) => {
      this.entries.delete(ptyId);
      finish();
      this.events.onExit(ptyId, exitCode);
    });
    return ptyId;
  }

  public write(ptyId: string, data: string): void {
    if (data.length > AGENT_CLI_MAX_INPUT_CHARS) throw new InteractiveTerminalError('terminal-input-too-large');
    this.require(ptyId).terminal.write(data);
  }

  public resize(ptyId: string, cols: number, rows: number): void {
    if (!isValidTerminalSize(cols, rows)) throw new InteractiveTerminalError('invalid-terminal-size');
    this.require(ptyId).terminal.resize(cols, rows);
  }

  public async close(ptyId: string): Promise<void> {
    const entry = this.entries.get(ptyId);
    if (entry === undefined) return;
    entry.closing ??= this.stop(ptyId, entry);
    await entry.closing;
  }

  private async stop(ptyId: string, entry: TerminalEntry): Promise<void> {
    entry.terminal.kill();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entry.exited,
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2500); }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    if (this.entries.has(ptyId)) {
      entry.terminal.kill('SIGKILL');
      this.entries.delete(ptyId);
    }
  }

  public async dispose(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((ptyId) => this.close(ptyId)));
  }

  private require(ptyId: string): TerminalEntry {
    const entry = this.entries.get(ptyId);
    if (entry === undefined) throw new InteractiveTerminalError('terminal-not-found');
    return entry;
  }
}
