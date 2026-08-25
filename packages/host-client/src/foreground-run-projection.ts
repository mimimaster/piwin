import type { ExecutionRunRecord, HostPush, HostResponse } from '@piwin/contracts';
import { isRunActive } from '@piwin/contracts';

export type ForegroundRunStatus = 'queued' | 'running' | 'cancelling';

export type ForegroundRunState =
  | { kind: 'unknown' }
  | { kind: 'reconciling'; generation: number }
  | { kind: 'idle'; generation: number }
  | {
      kind: 'active';
      generation: number;
      runId: string;
      status: ForegroundRunStatus;
      phase?: string;
    };

export type ForegroundRunEvent =
  | { type: 'reset' }
  | { type: 'begin-reconcile'; generation: number }
  | {
      type: 'foreground-run';
      generation: number;
      sessionId: string;
      run: ExecutionRunRecord | null;
    }
  | { type: 'run-updated'; run: ExecutionRunRecord }
  | { type: 'run-terminal'; run: ExecutionRunRecord };

const ACTIVE_STATUSES: ReadonlySet<ForegroundRunStatus> = new Set([
  'queued',
  'running',
  'cancelling',
]);

export function initialForegroundRunState(): ForegroundRunState {
  return { kind: 'unknown' };
}

export function foregroundMutationsEnabled(state: ForegroundRunState): boolean {
  return state.kind === 'idle' || state.kind === 'active';
}

export function knownForegroundRunId(state: ForegroundRunState): string | undefined {
  return state.kind === 'active' ? state.runId : undefined;
}

export function reduceForegroundRun(
  state: ForegroundRunState,
  event: ForegroundRunEvent,
  selectedSessionId: string | undefined,
): ForegroundRunState {
  switch (event.type) {
    case 'reset':
      return { kind: 'unknown' };
    case 'begin-reconcile':
      return { kind: 'reconciling', generation: event.generation };
    case 'foreground-run': {
      if (state.kind !== 'unknown' && state.generation !== event.generation) {
        return state;
      }
      if (selectedSessionId !== event.sessionId) {
        return state;
      }
      return projectRun(event.run, event.generation);
    }
    case 'run-updated': {
      if (selectedSessionId === undefined || event.run.sessionId !== selectedSessionId) {
        return state;
      }
      if (!isActiveRun(event.run)) {
        return state;
      }
      if (state.kind === 'active' && event.run.runId !== state.runId) {
        // A superseded Run stays in the registry as cancelling while the
        // replacement is already foreground. Only queued/running may take over.
        if (event.run.status === 'cancelling') {
          return state;
        }
      }
      const generation = state.kind === 'unknown' ? 0 : state.generation;
      return {
        kind: 'active',
        generation,
        runId: event.run.runId,
        status: event.run.status as ForegroundRunStatus,
        ...(event.run.phase === undefined ? {} : { phase: event.run.phase }),
      };
    }
    case 'run-terminal': {
      if (state.kind !== 'active' || event.run.runId !== state.runId) {
        return state;
      }
      if (selectedSessionId !== undefined && event.run.sessionId !== selectedSessionId) {
        return state;
      }
      return { kind: 'idle', generation: state.generation };
    }
  }
}

/** Apply a Host push. Message lifecycle events never terminalize a Run. */
export function applyHostPushToForeground(
  state: ForegroundRunState,
  push: HostPush,
  selectedSessionId: string | undefined,
): ForegroundRunState {
  if (push.type === 'run/updated') {
    return reduceForegroundRun(state, { type: 'run-updated', run: push.run }, selectedSessionId);
  }
  if (push.type === 'run/terminal') {
    return reduceForegroundRun(state, { type: 'run-terminal', run: push.run }, selectedSessionId);
  }
  return state;
}

export function applyForegroundRunResponse(
  state: ForegroundRunState,
  response: HostResponse,
  generation: number,
  selectedSessionId: string,
): ForegroundRunState {
  if (!response.success) {
    return state;
  }
  const run = readForegroundRunRecord(response.data);
  return reduceForegroundRun(
    state,
    { type: 'foreground-run', generation, sessionId: selectedSessionId, run },
    selectedSessionId,
  );
}

export function readForegroundRunRecord(data: unknown): ExecutionRunRecord | null {
  if (!isRecord(data)) {
    return null;
  }
  const run = data.run;
  if (run === null || run === undefined) {
    return null;
  }
  if (!isRecord(run) || typeof run.runId !== 'string' || run.runId.length === 0) {
    return null;
  }
  return run as unknown as ExecutionRunRecord;
}

function projectRun(run: ExecutionRunRecord | null, generation: number): ForegroundRunState {
  if (run === null || !isActiveRun(run)) {
    return { kind: 'idle', generation };
  }
  return {
    kind: 'active',
    generation,
    runId: run.runId,
    status: run.status as ForegroundRunStatus,
    ...(run.phase === undefined ? {} : { phase: run.phase }),
  };
}

function isActiveRun(run: ExecutionRunRecord): boolean {
  return isRunActive(run.status) && ACTIVE_STATUSES.has(run.status as ForegroundRunStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
