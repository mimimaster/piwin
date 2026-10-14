/**
 * Host pending registry for bounded native backend user-input prompts.
 *
 * Plugin frame correlation stays on the bridge; this registry is the client-
 * visible Host request id + generation/run scope authority. Answers never use
 * the generic 5s callback timer — they wait for respond or a lifecycle cancel.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentPluginSessionScope,
  BackendUserInputRequest,
  BackendUserInputResult,
  HostPush,
} from '@piwin/contracts';
import { parseBackendUserInputRequest, parseBackendUserInputResult } from '@piwin/contracts';

export type BackendUserInputPendingEntry = {
  sessionId: string;
  generationId: string;
  requestId: string;
  request: BackendUserInputRequest;
  runId?: string;
  resolve: (result: BackendUserInputResult) => void;
};

export type BackendUserInputPendingDeps = {
  push: (message: HostPush) => void;
  getForegroundRunId: (sessionId: string) => string | undefined;
  createRequestId?: () => string;
};

const MAX_PENDING = 32;

export class BackendUserInputPendingController {
  private readonly pending = new Map<string, BackendUserInputPendingEntry>();
  private readonly deps: BackendUserInputPendingDeps;

  constructor(deps: BackendUserInputPendingDeps) {
    this.deps = deps;
  }

  get size(): number {
    return this.pending.size;
  }

  /**
   * Bridge entry: parse the plugin payload, bind Host scope, push to clients,
   * and wait until respond / cancel. Stale generation/run refusals never open UI.
   */
  requestFromPlugin(
    params: unknown,
    scope: AgentPluginSessionScope,
  ): Promise<BackendUserInputResult> {
    if (!isRecord(params)) {
      return Promise.reject(new Error('invalid-request: input/request params'));
    }
    const request = parseBackendUserInputRequest(params.request);
    if (request === undefined) {
      return Promise.reject(new Error('invalid-request: backend user input shape'));
    }
    const activeRun = this.deps.getForegroundRunId(scope.sessionId);
    // An active Desktop/native prompt run is required even when the plugin omits runId.
    if (activeRun === undefined) {
      return Promise.reject(new Error('invalid-request: no active run for input/request'));
    }
    const runId = typeof params.runId === 'string' && params.runId.length > 0
      ? params.runId
      : activeRun;
    if (runId !== activeRun) {
      return Promise.reject(new Error('invalid-request: foreign run for input/request'));
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(new Error('invalid-request: backend user input pending limit'));
    }

    const requestId = this.deps.createRequestId?.() ?? randomUUID();
    return new Promise<BackendUserInputResult>((resolve) => {
      const entry: BackendUserInputPendingEntry = {
        sessionId: scope.sessionId,
        generationId: scope.runtimeGenerationId,
        requestId,
        request,
        resolve: (result) => {
          this.pending.delete(requestId);
          this.deps.push({
            type: 'session/backend-input-settled',
            sessionId: scope.sessionId,
            requestId,
            generationId: scope.runtimeGenerationId,
            result,
            ...(runId !== undefined ? { runId } : {}),
          });
          resolve(result);
        },
        ...(runId !== undefined ? { runId } : {}),
      };
      this.pending.set(requestId, entry);
      this.deps.push({
        type: 'session/backend-input-request',
        sessionId: scope.sessionId,
        requestId,
        generationId: scope.runtimeGenerationId,
        request,
        ...(runId !== undefined ? { runId } : {}),
      });
    });
  }

  /**
   * Client answer. Validates scope + result against the original request.
   * Stale/foreign generation, run, or request ids never reach a new generation.
   */
  respond(input: {
    sessionId: string;
    requestId: string;
    generationId: string;
    result: unknown;
    runId?: string;
  }): { ok: true } | { ok: false; error: string } {
    const entry = this.pending.get(input.requestId);
    if (entry === undefined) {
      return { ok: false, error: 'ticket-consumed' };
    }
    if (
      entry.sessionId !== input.sessionId ||
      entry.generationId !== input.generationId ||
      (input.runId !== undefined && entry.runId !== undefined && entry.runId !== input.runId) ||
      (entry.runId !== undefined && input.runId === undefined)
    ) {
      return { ok: false, error: 'input-scope-mismatch' };
    }
    const result = parseBackendUserInputResult(input.result, entry.request);
    if (result === undefined) {
      return { ok: false, error: 'invalid-input-result' };
    }
    entry.resolve(result);
    return { ok: true };
  }

  cancelSession(sessionId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.sessionId === sessionId) {
        entry.resolve({ cancelled: true });
      }
    }
  }

  cancelRun(sessionId: string, runId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.sessionId === sessionId && entry.runId === runId) {
        entry.resolve({ cancelled: true });
      }
    }
  }

  cancelGeneration(sessionId: string, generationId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.sessionId === sessionId && entry.generationId === generationId) {
        entry.resolve({ cancelled: true });
      }
    }
  }

  dispose(): void {
    for (const entry of [...this.pending.values()]) {
      entry.resolve({ cancelled: true });
    }
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
