/**
 * CE-PTY: lightweight interactive shell sessions without node-pty.
 * Uses piped stdio shell (not a full TTY); good enough for basic commands.
 * Real PTY (node-pty) can replace this later behind the same IPC.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PtyOpenInput, PtySessionSummary } from '@piwin/contracts';
import { isPathInsideRoot } from '@piwin/process';

export type PtyHostOptions = {
  isProjectTrusted: (projectPath: string) => Promise<boolean>;
  onOutput: (ptyId: string, data: string) => void;
  onExit: (ptyId: string, exitCode: number | null) => void;
};

type PtyEntry = {
  summary: PtySessionSummary;
  child: ChildProcessWithoutNullStreams;
};

export class PtyHost {
  private readonly sessions = new Map<string, PtyEntry>();

  constructor(private readonly options: PtyHostOptions) {}

  async open(input: PtyOpenInput): Promise<PtySessionSummary> {
    const projectPath = resolve(input.projectPath);
    const trusted = await this.options.isProjectTrusted(projectPath);
    if (!trusted) {
      throw new Error('PTY requires a trusted project');
    }
    const cwd = resolve(input.cwd?.trim() || projectPath);
    if (!isPathInsideRoot(cwd, projectPath)) {
      throw new Error('PTY cwd must be inside the project path');
    }
    const shell =
      input.shell?.trim() ||
      process.env.SHELL ||
      (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const id = randomUUID();
    const child = spawn(shell, [], {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PIWIN_PTY: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const summary: PtySessionSummary = {
      id,
      projectPath,
      cwd,
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    child.stdout.on('data', (chunk: Buffer) => {
      this.options.onOutput(id, chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.options.onOutput(id, chunk.toString('utf8'));
    });
    child.on('exit', (code) => {
      const entry = this.sessions.get(id);
      if (entry) {
        entry.summary.status = 'closed';
      }
      this.options.onExit(id, code);
      this.sessions.delete(id);
    });
    child.on('error', (error) => {
      const entry = this.sessions.get(id);
      if (entry) {
        entry.summary.status = 'error';
        entry.summary.errorMessage = error.message;
      }
      this.options.onOutput(id, `\r\n[pty error] ${error.message}\r\n`);
    });
    this.sessions.set(id, { summary, child });
    return summary;
  }

  write(ptyId: string, data: string): void {
    const entry = this.sessions.get(ptyId);
    if (!entry || entry.summary.status !== 'open') {
      throw new Error(`PTY not open: ${ptyId}`);
    }
    entry.child.stdin.write(data);
  }

  resize(_ptyId: string, _cols: number, _rows: number): void {
    // Piped shell has no real winsize; no-op for compatibility.
  }

  close(ptyId: string): void {
    const entry = this.sessions.get(ptyId);
    if (!entry) return;
    entry.child.kill('SIGTERM');
    setTimeout(() => {
      if (entry.child.exitCode === null) {
        entry.child.kill('SIGKILL');
      }
    }, 1500).unref?.();
  }

  list(projectPath?: string): PtySessionSummary[] {
    const all = [...this.sessions.values()].map((entry) => entry.summary);
    if (!projectPath) return all;
    const resolved = resolve(projectPath);
    return all.filter((item) => item.projectPath === resolved);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) {
      this.close(id);
    }
  }
}
