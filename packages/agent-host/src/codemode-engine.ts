/**
 * Public Codemode engine adapter.
 *
 * Host-runtime composes tools and the execution port. This module is the only
 * place that constructs `@earendil-works/pi-codemode`. It does not import
 * host-runtime. `store`/`load` are invocation-local: each run passes an empty
 * store and discards writes.
 */

import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CodemodeSandbox,
  loadQuickJSWasm,
  parseCodemodeSource,
  type CodemodeCall,
  type CodemodeTool,
} from '@earendil-works/pi-codemode';

export { parseCodemodeSource };

export type CodemodeEngineTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  execute(args: unknown, context: { signal: AbortSignal }): Promise<unknown> | unknown;
};

export type CodemodeEngineLimits = {
  timeoutMs: number;
  memoryLimitBytes: number;
  maxCalls: number;
  maxConcurrency: number;
  maxOutputChars: number;
};

export type CodemodeEngineCall = {
  name: string;
  status: CodemodeCall['status'];
  durationMs: number;
};

export type CodemodeEngineResult = {
  ok: boolean;
  outputText: string;
  truncated: boolean;
  calls: CodemodeEngineCall[];
  error?: { kind: string; message: string };
};

export function resolveCodemodeRuntimeAssets(): { wasmPath: string; workerUrl: URL } {
  const packageRoot = realpathSync(findPackageRoot(fileURLToPath(new URL('.', import.meta.url))));
  const workerPath = join(packageRoot, 'dist/runtime/worker.js');
  const candidates = [
    join(dirname(dirname(packageRoot)), 'quickjs-wasi', 'quickjs.wasm'),
    join(packageRoot, 'node_modules', 'quickjs-wasi', 'quickjs.wasm'),
  ];
  const wasmPath = candidates.find((candidate) => existsSync(candidate));
  if (!existsSync(workerPath) || !wasmPath) {
    throw new Error(
      `pi-codemode worker or quickjs wasm missing: worker=${workerPath} wasm=${candidates.join(',')}`,
    );
  }
  return { wasmPath, workerUrl: pathToFileURL(workerPath) };
}

function findPackageRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'node_modules/@earendil-works/pi-codemode/package.json');
    if (existsSync(candidate)) {
      return dirname(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`unable to locate @earendil-works/pi-codemode from ${start}`);
}

export async function runCodemodeScript(input: {
  code: string;
  tools: readonly CodemodeEngineTool[];
  limits: CodemodeEngineLimits;
  signal: AbortSignal;
}): Promise<CodemodeEngineResult> {
  const assets = resolveCodemodeRuntimeAssets();
  const gate = new CallGate(input.limits.maxCalls, input.limits.maxConcurrency);
  const sandbox = new CodemodeSandbox({
    timeoutMs: input.limits.timeoutMs,
    memoryLimitBytes: input.limits.memoryLimitBytes,
    wasm: loadQuickJSWasm(assets.wasmPath),
    workerUrl: assets.workerUrl,
    tools: input.tools.map((tool) => wrapTool(tool, gate)),
  });
  try {
    const result = await sandbox.execute(input.code, {
      signal: input.signal,
      timeoutMs: input.limits.timeoutMs,
      store: {},
    });
    const projected = projectEngineOutput(result.output, result.ok ? result.value : undefined, input.limits.maxOutputChars);
    const calls = result.calls.map((call) => ({
      name: call.name,
      status: call.status,
      durationMs: call.durationMs,
    }));
    if (result.ok) {
      return { ok: true, outputText: projected.text, truncated: projected.truncated, calls };
    }
    return {
      ok: false,
      outputText: projected.text,
      truncated: projected.truncated,
      calls,
      error: { kind: result.error.kind, message: boundText(result.error.message, input.limits.maxOutputChars) },
    };
  } finally {
    await sandbox.close();
  }
}

function wrapTool(tool: CodemodeEngineTool, gate: CallGate): CodemodeTool {
  const wrapped: CodemodeTool = {
    name: tool.name,
    execute: async (args, context) => {
      const release = await gate.acquire(context.signal);
      try {
        if (context.signal.aborted) {
          throw new Error('codemode call aborted before start');
        }
        return await tool.execute(args, context);
      } finally {
        release();
      }
    },
  };
  if (tool.description !== undefined) {
    wrapped.description = tool.description;
  }
  if (tool.inputSchema !== undefined) {
    wrapped.inputSchema = tool.inputSchema;
  }
  return wrapped;
}

function projectEngineOutput(
  output: ReadonlyArray<{ type: string; text?: string }>,
  value: unknown,
  maxChars: number,
): { text: string; truncated: boolean } {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 0) {
      parts.push(item.text);
    }
  }
  if (value !== undefined) {
    parts.push(safeJson(value));
  }
  return boundJoined(parts, maxChars);
}

function boundJoined(parts: readonly string[], maxChars: number): { text: string; truncated: boolean } {
  const joined = parts.filter((part) => part.length > 0).join('\n');
  if (joined.length <= maxChars) {
    return { text: joined, truncated: false };
  }
  const marker = '\n…[codemode output truncated]';
  const keep = Math.max(0, maxChars - marker.length);
  return { text: `${joined.slice(0, keep)}${marker}`, truncated: true };
}

function boundText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n…[truncated]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

type Waiter = { grant: () => void };

class CallGate {
  private active = 0;
  private started = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly maxCalls: number,
    private readonly maxConcurrency: number,
  ) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      throw new Error('codemode call aborted before start');
    }
    if (this.started >= this.maxCalls) {
      throw new Error('codemode call budget exceeded');
    }
    this.started += 1;
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          grant: () => {
            signal.removeEventListener('abort', onAbort);
            if (signal.aborted) {
              reject(new Error('codemode call aborted before start'));
              this.grantNext();
              return;
            }
            resolve();
          },
        };
        const onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          reject(new Error('codemode call aborted before start'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.waiters.push(waiter);
      });
    }
    if (signal.aborted) {
      throw new Error('codemode call aborted before start');
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= 1;
      this.grantNext();
    };
  }

  private grantNext(): void {
    const next = this.waiters.shift();
    next?.grant();
  }
}

