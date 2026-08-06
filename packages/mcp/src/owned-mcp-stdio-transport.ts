import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type MessageExtraInfo,
} from '@modelcontextprotocol/sdk/types.js';
import { closeMcpProcessTree } from './mcp-process-tree.js';

export type OwnedMcpStdioTransportOptions = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/**
 * SDK-compatible stdio transport with explicit process ownership.
 *
 * The SDK's default StdioClientTransport only closes the direct child. This
 * transport keeps the same newline-framed protocol while putting the child in
 * an owned process group so npx/node descendants are closed with it.
 */
export class OwnedMcpStdioTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: <T extends JSONRPCMessage>(
    message: T,
    extra?: MessageExtraInfo,
  ) => void;

  private child: ChildProcessWithoutNullStreams | null = null;
  private spawnedPid: number | undefined;
  private started = false;
  private closed = false;
  private closeRequested = false;
  private closeNotified = false;
  private closePromise: Promise<void> | null = null;
  private buffer = '';

  public constructor(private readonly options: OwnedMcpStdioTransportOptions) {}

  public get pid(): number | undefined {
    return this.spawnedPid;
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error('OwnedMcpStdioTransport already started');
    }
    this.started = true;
    if (this.closeRequested) {
      this.closed = true;
      this.notifyClose();
      throw new Error('OwnedMcpStdioTransport was closed before start');
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.options.command, this.options.args, {
          env: this.options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          windowsHide: process.platform === 'win32',
        });
      } catch (error) {
        const normalized = toError(error);
        this.onerror?.(normalized);
        reject(normalized);
        return;
      }

      this.child = child;
      this.spawnedPid = child.pid ?? undefined;
      const failStart = (error: unknown): void => {
        const normalized = toError(error);
        this.onerror?.(normalized);
        if (!settled) {
          settled = true;
          reject(normalized);
        }
      };

      child.once('spawn', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      child.once('error', failStart);
      child.once('close', () => {
        this.closed = true;
        if (!settled) {
          settled = true;
          reject(new Error('MCP server exited before stdio transport started'));
        }
        this.notifyClose();
      });
      child.stdin.on('error', (error) => this.onerror?.(error));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.consumeOutput(chunk));
      child.stdout.on('error', (error) => this.onerror?.(error));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', () => {
        // Stderr is intentionally drained; server diagnostics do not alter the
        // JSON-RPC stream or the process ownership state.
      });
      child.stderr.on('error', (error) => this.onerror?.(error));
    });
  }

  public async send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions,
  ): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || this.closed || this.closeRequested) {
      throw new Error('OwnedMcpStdioTransport is not connected');
    }
    const serialized = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        stdin.removeListener('error', onError);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onError = (error: Error): void => finish(error);
      stdin.once('error', onError);
      try {
        stdin.write(serialized, (error?: Error | null) => finish(error));
      } catch (error) {
        finish(toError(error));
      }
    });
  }

  public close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closeRequested = true;
    const child = this.child;
    if (!child) {
      this.closed = true;
      this.notifyClose();
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }

    this.closePromise = (async () => {
      try {
        await closeMcpProcessTree(child, this.spawnedPid);
      } finally {
        this.closed = true;
        this.notifyClose();
      }
    })();
    return this.closePromise;
  }

  private consumeOutput(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        const message = JSONRPCMessageSchema.parse(JSON.parse(line));
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(toError(error));
      }
    }
  }

  private notifyClose(): void {
    if (this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    this.onclose?.();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
