/**
 * Generation-scoped at-most-once runner admission for Host tool calls.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { ToolResult } from '@piwin/contracts';
import { stableCanonicalJson } from './stable-canonical-json.js';

export const DEFAULT_LEDGER_MAX_KEYS_PER_RUN = 4096;
export const DEFAULT_LEDGER_MAX_REPLAY_ENTRIES = 512;
export const DEFAULT_LEDGER_MAX_REPLAY_BYTES = 16 * 1024 * 1024;

export type LedgerAttempt = {
  invocationId: string;
  signal: AbortSignal;
  markRunnerStarted(): void;
};

export type ToolInvocationLedgerOptions = {
  maxKeysPerRun?: number;
  maxReplayEntries?: number;
  maxReplayBytes?: number;
};

type InvocationEntry = {
  runId: string;
  toolCallId: string;
  fingerprint: string;
  runnerStarted: boolean;
  resultState: 'pending' | 'cached' | 'unavailable';
  bodyPromise?: Promise<ToolResult>;
  runnerCompletion?: Promise<void>;
  abortController: AbortController;
  waiterCount: number;
  closed: boolean;
};

type ReplayRecord = {
  key: string;
  result: ToolResult;
  bytes: number;
};

export class ToolInvocationLedger {
  private readonly maxKeysPerRun: number;
  private readonly maxReplayEntries: number;
  private readonly maxReplayBytes: number;
  private readonly entries = new Map<string, InvocationEntry>();
  private readonly keysByRun = new Map<string, Set<string>>();
  private readonly replay = new Map<string, ReplayRecord>();
  private replayBytes = 0;
  private accepting = true;

  constructor(options: ToolInvocationLedgerOptions = {}) {
    this.maxKeysPerRun = options.maxKeysPerRun ?? DEFAULT_LEDGER_MAX_KEYS_PER_RUN;
    this.maxReplayEntries = options.maxReplayEntries ?? DEFAULT_LEDGER_MAX_REPLAY_ENTRIES;
    this.maxReplayBytes = options.maxReplayBytes ?? DEFAULT_LEDGER_MAX_REPLAY_BYTES;
  }

  async run(
    input: {
      runId: string;
      toolCallId: string;
      toolName: string;
      fingerprint: string;
      callerSignal: AbortSignal;
    },
    body: (attempt: LedgerAttempt) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    if (!this.accepting) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'tool invocation ledger is disposed',
      };
    }

    const key = invocationKey(input.runId, input.toolCallId);
    const existing = this.entries.get(key);
    if (!existing) {
      const runKeys = this.keysByRun.get(input.runId) ?? new Set<string>();
      if (runKeys.size >= this.maxKeysPerRun) {
        return {
          ok: false,
          code: 'tool-not-available',
          message: 'tool invocation ledger capacity exceeded',
        };
      }
      const abortController = new AbortController();
      const created: InvocationEntry = {
        runId: input.runId,
        toolCallId: input.toolCallId,
        fingerprint: input.fingerprint,
        runnerStarted: false,
        resultState: 'pending',
        abortController,
        waiterCount: 0,
        closed: false,
      };
      this.entries.set(key, created);
      runKeys.add(key);
      this.keysByRun.set(input.runId, runKeys);
      created.bodyPromise = this.executeBody(created, body);
    }

    const entry = this.entries.get(key);
    if (!entry) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'tool invocation ledger entry missing',
      };
    }
    if (entry.fingerprint !== input.fingerprint) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'tool call argument mismatch for toolCallId',
      };
    }
    if (entry.resultState === 'cached') {
      const cached = this.replay.get(key);
      if (cached) {
        this.touchReplay(key);
        return cached.result;
      }
      entry.resultState = 'unavailable';
    }
    if (entry.resultState === 'unavailable') {
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'tool call already settled; replay result unavailable',
      };
    }

    entry.waiterCount += 1;
    return await this.waitForSharedResult(entry, input.callerSignal);
  }

  releaseRun(runId: string): void {
    const keys = this.keysByRun.get(runId);
    if (!keys) {
      return;
    }
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        this.abandonEntry(entry, key);
      }
    }
    this.keysByRun.delete(runId);
  }

  dispose(): void {
    this.accepting = false;
    for (const [key, entry] of this.entries) {
      this.abandonEntry(entry, key);
    }
    this.entries.clear();
    this.keysByRun.clear();
    this.replay.clear();
    this.replayBytes = 0;
  }

  private async executeBody(
    entry: InvocationEntry,
    body: (attempt: LedgerAttempt) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const attempt: LedgerAttempt = {
      invocationId: entry.toolCallId,
      signal: entry.abortController.signal,
      markRunnerStarted: () => {
        entry.runnerStarted = true;
      },
    };
    let result: ToolResult;
    try {
      result = await body(attempt);
    } catch (error) {
      result = entry.abortController.signal.aborted
        ? { ok: false, code: 'aborted', message: 'tool execution aborted' }
        : {
            ok: false,
            code: 'execution-failed',
            message: error instanceof Error ? error.message : String(error),
          };
    }

    const key = invocationKey(entry.runId, entry.toolCallId);
    if (this.entries.get(key) !== entry) {
      return result;
    }
    if (!entry.runnerStarted && isAbortResult(result)) {
      this.deleteEntry(entry);
      return result;
    }

    this.settle(entry, result);
    return result;
  }

  private async waitForSharedResult(
    entry: InvocationEntry,
    callerSignal: AbortSignal,
  ): Promise<ToolResult> {
    const shared = entry.bodyPromise;
    if (!shared) {
      entry.waiterCount = Math.max(0, entry.waiterCount - 1);
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'tool invocation ledger entry missing',
      };
    }

    if (callerSignal.aborted) {
      this.dropWaiter(entry);
      return { ok: false, code: 'aborted', message: 'tool execution aborted' };
    }

    return await new Promise<ToolResult>((resolve) => {
      let finished = false;
      const finish = (result: ToolResult): void => {
        if (finished) {
          return;
        }
        finished = true;
        callerSignal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        this.dropWaiter(entry);
        finish({ ok: false, code: 'aborted', message: 'tool execution aborted' });
      };
      callerSignal.addEventListener('abort', onAbort, { once: true });
      void shared.then((result) => {
        if (!finished) {
          this.dropWaiter(entry, { keepShared: true });
        }
        finish(result);
      });
    });
  }

  private dropWaiter(entry: InvocationEntry, options: { keepShared?: boolean } = {}): void {
    entry.waiterCount = Math.max(0, entry.waiterCount - 1);
    if (entry.waiterCount === 0 && !options.keepShared) {
      // Always abort the shared runner signal so execute() sees cancel.
      // Only pre-start aborts may delete the entry and allow re-entry.
      if (!entry.abortController.signal.aborted) {
        entry.abortController.abort();
      }
      if (!entry.runnerStarted) {
        this.deleteEntry(entry);
      }
    }
  }

  private settle(entry: InvocationEntry, result: ToolResult): void {
    const key = invocationKey(entry.runId, entry.toolCallId);
    delete entry.bodyPromise;
    const bytes = estimateResultBytes(result);
    if (bytes <= this.maxReplayBytes) {
      this.storeReplay(key, result, bytes);
      entry.resultState = 'cached';
    } else {
      this.evictReplay(key);
      entry.resultState = 'unavailable';
    }
  }

  private storeReplay(key: string, result: ToolResult, bytes: number): void {
    this.evictReplay(key);
    while (
      this.replay.size >= this.maxReplayEntries ||
      this.replayBytes + bytes > this.maxReplayBytes
    ) {
      const oldest = this.replay.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.evictReplay(oldest);
    }
    if (this.replayBytes + bytes > this.maxReplayBytes) {
      const entry = this.entries.get(key);
      if (entry) {
        entry.resultState = 'unavailable';
      }
      return;
    }
    this.replay.set(key, { key, result, bytes });
    this.replayBytes += bytes;
  }

  private touchReplay(key: string): void {
    const record = this.replay.get(key);
    if (!record) {
      return;
    }
    this.replay.delete(key);
    this.replay.set(key, record);
  }

  private evictReplay(key: string): void {
    const record = this.replay.get(key);
    if (!record) {
      return;
    }
    this.replay.delete(key);
    this.replayBytes -= record.bytes;
    const entry = this.entries.get(key);
    if (entry && entry.resultState === 'cached') {
      entry.resultState = 'unavailable';
    }
  }

  private deleteEntry(entry: InvocationEntry): void {
    const key = invocationKey(entry.runId, entry.toolCallId);
    this.entries.delete(key);
    this.evictReplay(key);
    const runKeys = this.keysByRun.get(entry.runId);
    runKeys?.delete(key);
    if (runKeys && runKeys.size === 0) {
      this.keysByRun.delete(entry.runId);
    }
  }

  private abandonEntry(entry: InvocationEntry, key: string): void {
    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort();
    }
    if (entry.bodyPromise) {
      void entry.bodyPromise.catch(() => undefined);
    }
    if (entry.runnerCompletion) {
      void entry.runnerCompletion.catch(() => undefined);
    }
    this.entries.delete(key);
    this.evictReplay(key);
  }
}

export function fingerprintToolInvocation(
  toolName: string,
  canonicalArgs: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(`${toolName}\n${stableCanonicalJson(canonicalArgs)}`, 'utf8')
    .digest('hex');
}

export function untrackedInvocationId(): string {
  return randomUUID();
}

function invocationKey(runId: string, toolCallId: string): string {
  return `${runId}\u0000${toolCallId}`;
}

function isAbortResult(result: ToolResult): boolean {
  return result.ok === false && result.code === 'aborted';
}

function estimateResultBytes(result: ToolResult): number {
  const text = result.ok ? result.output : result.message;
  const details = result.details ? Buffer.byteLength(JSON.stringify(result.details), 'utf8') : 0;
  return Buffer.byteLength(text, 'utf8') + details;
}
