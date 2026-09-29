import { spawn } from 'node:child_process';
import type { AcpLineTransport, AcpTransportCloseInfo } from '@piwin/acp-agent';

const DEFAULT_KILL_TIMEOUT_MS = 3_000;
const DEFAULT_STDERR_RING_CHARS = 16_384;

export class GrokProcessClosedError extends Error {
  override readonly name = 'GrokProcessClosedError';

  constructor() {
    super('Grok ACP process is closed');
    this.name = 'GrokProcessClosedError';
  }
}

export type GrokChildProcess = {
  stdin: NodeJS.WritableStream & { end(): void; writable?: boolean };
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

export type GrokSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
) => GrokChildProcess;

export type GrokProcessTransport = AcpLineTransport & {
  readonly pid: number | undefined;
  stderrTail(): string;
};

export type GrokProcessTransportOptions = {
  binaryPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: GrokSpawn;
  killTimeoutMs?: number;
  stderrRingBytes?: number;
};

export function createGrokProcessTransport(
  options: GrokProcessTransportOptions,
): GrokProcessTransport {
  return new GrokStdioTransport(options);
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
): GrokChildProcess {
  const spawnOptions: { cwd?: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] } = {
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  if (options.cwd !== undefined) {
    spawnOptions.cwd = options.cwd;
  }
  const child = spawn(command, [...args], spawnOptions);
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdin === null || stdout === null || stderr === null) {
    child.kill('SIGKILL');
    throw new GrokProcessClosedError();
  }
  const grokChild: GrokChildProcess = {
    stdin,
    stdout,
    stderr,
    kill(signal?: NodeJS.Signals): boolean {
      return child.kill(signal);
    },
    on: bindChildEvents(child),
  };
  if (typeof child.pid === 'number') {
    grokChild.pid = child.pid;
  }
  return grokChild;
}

class GrokStdioTransport implements GrokProcessTransport {
  readonly pid: number | undefined;
  private readonly child: GrokChildProcess;
  private readonly killTimeoutMs: number;
  private readonly stderrRingChars: number;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly closeListeners = new Set<(info: AcpTransportCloseInfo) => void>();
  private readonly exitWaiters: Array<() => void> = [];
  private stdoutCarry = '';
  private stderrBuffer = '';
  private closed = false;
  private exited = false;
  private closeEmitted = false;
  private closePromise: Promise<void> | undefined;
  private killTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: GrokProcessTransportOptions) {
    this.killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
    this.stderrRingChars = options.stderrRingBytes ?? DEFAULT_STDERR_RING_CHARS;
    const spawnChild = options.spawn ?? defaultSpawn;
    const spawnOptions: { cwd?: string; env: NodeJS.ProcessEnv } = {
      env: options.env ?? process.env,
    };
    if (options.cwd !== undefined) {
      spawnOptions.cwd = options.cwd;
    }
    this.child = spawnChild(options.binaryPath, ['agent', 'stdio'], spawnOptions);
    this.pid = this.child.pid;
    this.child.stdout.on('data', (chunk: string | Buffer) => {
      this.handleStdout(asText(chunk));
    });
    this.child.stderr.on('data', (chunk: string | Buffer) => {
      this.appendStderr(asText(chunk));
    });
    this.child.on('exit', (code, signal) => {
      this.handleExit({ code, signal: signal ?? null });
    });
    this.child.on('error', (error) => {
      this.handleExit({
        code: null,
        signal: null,
        reason: `${error.name}: ${error.message}`,
      });
    });
  }

  send(line: string): void {
    if (this.closed || this.child.stdin.writable === false) {
      throw new GrokProcessClosedError();
    }
    this.child.stdin.write(`${line}\n`);
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => {
      this.lineListeners.delete(listener);
    };
  }

  onClose(listener: (info: AcpTransportCloseInfo) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  stderrTail(): string {
    return this.stderrBuffer;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    this.closed = true;
    if (this.exited) {
      return;
    }
    if (this.child.stdin.writable !== false) {
      this.child.stdin.end();
    }
    this.child.kill('SIGTERM');
    const exitedBeforeKill = await this.waitForExitOrTimeout();
    if (exitedBeforeKill || this.exited) {
      return;
    }
    this.child.kill('SIGKILL');
    await this.waitForExit();
  }

  private handleStdout(chunk: string): void {
    this.stdoutCarry += chunk;
    while (true) {
      const newlineIndex = this.stdoutCarry.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }
      let line = this.stdoutCarry.slice(0, newlineIndex);
      this.stdoutCarry = this.stdoutCarry.slice(newlineIndex + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      if (line.length === 0) {
        continue;
      }
      for (const listener of [...this.lineListeners]) {
        listener(line);
      }
    }
  }

  private appendStderr(chunk: string): void {
    if (this.stderrRingChars <= 0) {
      this.stderrBuffer = '';
      return;
    }
    const next = this.stderrBuffer + chunk;
    this.stderrBuffer =
      next.length <= this.stderrRingChars ? next : next.slice(next.length - this.stderrRingChars);
  }

  private handleExit(info: AcpTransportCloseInfo): void {
    this.exited = true;
    this.closed = true;
    if (this.killTimer !== undefined) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
    const waiters = this.exitWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
    if (this.closeEmitted) {
      return;
    }
    this.closeEmitted = true;
    for (const listener of [...this.closeListeners]) {
      listener(info);
    }
  }

  private waitForExit(): Promise<void> {
    if (this.exited) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.exitWaiters.push(resolve);
    });
  }

  private waitForExitOrTimeout(): Promise<boolean> {
    if (this.exited) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onExit = (): void => {
        if (this.killTimer !== undefined) {
          clearTimeout(this.killTimer);
          this.killTimer = undefined;
        }
        resolve(true);
      };
      this.exitWaiters.push(onExit);
      this.killTimer = setTimeout(() => {
        this.killTimer = undefined;
        const index = this.exitWaiters.indexOf(onExit);
        if (index >= 0) {
          this.exitWaiters.splice(index, 1);
        }
        resolve(false);
      }, this.killTimeoutMs);
    });
  }
}


function bindChildEvents(child: { on(event: string, listener: (...args: never[]) => void): unknown }): GrokChildProcess['on'] {
  return ((
    event: 'exit' | 'error',
    listener:
      | ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ) => child.on(event, listener as (...args: never[]) => void)) as GrokChildProcess['on'];
}

function asText(chunk: string | Buffer): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
}
