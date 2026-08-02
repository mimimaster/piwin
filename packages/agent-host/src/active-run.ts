/**
 * ADR 0015: foreground run registry for a single session.
 * One session permits at most one ActiveRun; terminal emission is guarded.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  SessionRunOutcome,
  SessionRunPhase,
  SessionRunTerminalCode,
} from '@piwin/contracts';
import type { RunAbortReason } from './run-abort-reason.js';
import {
  createHostShutdownAbortReason,
  createUserStopAbortReason,
} from './run-abort-reason.js';

export type ActiveRun = {
  runId: string;
  sessionId: string;
  startedAt: number;
  abortController: AbortController;
  firstTokenReceived: boolean;
  terminalEmitted: boolean;
  phase: SessionRunPhase;
};

export type ActiveRunRegistry = {
  get: (sessionId: string) => ActiveRun | undefined;
  /** Register a new run. Throws if a non-terminal run already exists. */
  register: (sessionId: string) => ActiveRun;
  /**
   * Mark terminal for the matching run. Returns false if already terminal or
   * runId does not match the current active run.
   */
  markTerminal: (sessionId: string, runId: string) => boolean;
  /**
   * Remove the active run if runId matches (or if runId is omitted).
   * Returns the removed run or undefined.
   */
  clear: (sessionId: string, runId?: string) => ActiveRun | undefined;
  /** Request cancellation; returns undefined if no matching active run. */
  requestCancel: (
    sessionId: string,
    runId?: string,
    reason?: RunAbortReason,
  ) => ActiveRun | undefined;
  /** Derive phase transition from a normalized AgentEvent, if any. */
  noteAgentEvent: (sessionId: string, event: AgentEvent) => SessionRunPhase | null;
  /** Cancel and clear every active run (shutdown). */
  cancelAll: () => ActiveRun[];
};

export function createActiveRunRegistry(): ActiveRunRegistry {
  const runs = new Map<string, ActiveRun>();

  function get(sessionId: string): ActiveRun | undefined {
    return runs.get(sessionId);
  }

  function register(sessionId: string): ActiveRun {
    const existing = runs.get(sessionId);
    if (existing && !existing.terminalEmitted) {
      throw new Error(
        `run-active: session ${sessionId} already has foreground run ${existing.runId}`,
      );
    }
    const run: ActiveRun = {
      runId: randomUUID(),
      sessionId,
      startedAt: Date.now(),
      abortController: new AbortController(),
      firstTokenReceived: false,
      terminalEmitted: false,
      phase: 'accepted',
    };
    runs.set(sessionId, run);
    return run;
  }

  function markTerminal(sessionId: string, runId: string): boolean {
    const run = runs.get(sessionId);
    if (!run || run.runId !== runId || run.terminalEmitted) {
      return false;
    }
    run.terminalEmitted = true;
    return true;
  }

  function clear(sessionId: string, runId?: string): ActiveRun | undefined {
    const run = runs.get(sessionId);
    if (!run) {
      return undefined;
    }
    if (runId !== undefined && run.runId !== runId) {
      return undefined;
    }
    runs.delete(sessionId);
    return run;
  }

  function requestCancel(
    sessionId: string,
    runId?: string,
    reason?: RunAbortReason,
  ): ActiveRun | undefined {
    const run = runs.get(sessionId);
    if (!run || run.terminalEmitted) {
      return undefined;
    }
    if (runId !== undefined && run.runId !== runId) {
      return undefined;
    }
    run.phase = 'cancelling';
    // AbortSignal.reason is read by gated tools (bash) for model-facing copy.
    run.abortController.abort(reason ?? createUserStopAbortReason());
    return run;
  }

  function noteAgentEvent(sessionId: string, event: AgentEvent): SessionRunPhase | null {
    const run = runs.get(sessionId);
    if (!run || run.terminalEmitted || run.phase === 'cancelling') {
      return null;
    }
    if ('runId' in event && event.runId !== undefined && event.runId !== run.runId) {
      return null;
    }
    let next: SessionRunPhase | null = null;
    switch (event.type) {
      case 'message/text_delta':
      case 'message/thinking_delta':
        if (!run.firstTokenReceived) {
          run.firstTokenReceived = true;
        }
        if (run.phase !== 'streaming' && run.phase !== 'tool-running') {
          next = 'streaming';
        }
        break;
      case 'tool/start':
        next = 'tool-running';
        break;
      case 'tool/end':
        if (run.phase === 'tool-running') {
          next = 'streaming';
        }
        break;
      case 'permission/request':
        next = 'waiting-permission';
        break;
      default:
        break;
    }
    if (next !== null && next !== run.phase) {
      run.phase = next;
      return next;
    }
    return null;
  }

  function cancelAll(): ActiveRun[] {
    const cancelled: ActiveRun[] = [];
    for (const run of runs.values()) {
      if (!run.terminalEmitted) {
        run.phase = 'cancelling';
        run.abortController.abort(createHostShutdownAbortReason());
        cancelled.push(run);
      }
    }
    runs.clear();
    return cancelled;
  }

  return { get, register, markTerminal, clear, requestCancel, noteAgentEvent, cancelAll };
}

export function buildRunPhaseEvent(
  sessionId: string,
  runId: string,
  phase: SessionRunPhase,
  detail?: string,
): AgentEvent {
  if (detail !== undefined) {
    return {
      type: 'run/phase',
      sessionId,
      runId,
      phase,
      at: new Date().toISOString(),
      detail,
    };
  }
  return {
    type: 'run/phase',
    sessionId,
    runId,
    phase,
    at: new Date().toISOString(),
  };
}

export function buildRunTerminalEvent(
  sessionId: string,
  runId: string,
  outcome: SessionRunOutcome,
  code?: SessionRunTerminalCode,
  message?: string,
): AgentEvent {
  const event: {
    type: 'run/terminal';
    sessionId: string;
    runId: string;
    outcome: SessionRunOutcome;
    at: string;
    code?: SessionRunTerminalCode;
    message?: string;
  } = {
    type: 'run/terminal',
    sessionId,
    runId,
    outcome,
    at: new Date().toISOString(),
  };
  if (code !== undefined) {
    event.code = code;
  }
  if (message !== undefined) {
    event.message = message;
  }
  return event as AgentEvent;
}
