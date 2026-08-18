import type {
  ExecutionRunRecord,
  ForegroundRunMismatchProblem,
  ForegroundRunMismatchReason,
  PromptForegroundAdmission,
} from '@piwin/contracts';

/** Per-HostRuntime gate so concurrent explicit admissions cannot both win. */
export class PromptAdmissionGate {
  private readonly reservedSessionIds = new Set<string>();

  tryReserve(sessionId: string): boolean {
    if (this.reservedSessionIds.has(sessionId)) {
      return false;
    }
    this.reservedSessionIds.add(sessionId);
    return true;
  }

  release(sessionId: string): void {
    this.reservedSessionIds.delete(sessionId);
  }

  isReserved(sessionId: string): boolean {
    return this.reservedSessionIds.has(sessionId);
  }
}

function actualRunFrom(
  run: ExecutionRunRecord,
): NonNullable<ForegroundRunMismatchProblem['data']['actualRun']> | undefined {
  if (run.status !== 'queued' && run.status !== 'running' && run.status !== 'cancelling') {
    return undefined;
  }
  return {
    runId: run.runId,
    status: run.status,
    ...(run.phase === undefined ? {} : { phase: run.phase }),
  };
}

export function createForegroundRunMismatch(
  reason: ForegroundRunMismatchReason,
  run?: ExecutionRunRecord,
): ForegroundRunMismatchProblem {
  const actualRun = run === undefined ? undefined : actualRunFrom(run);
  return {
    code: 'foreground-run-mismatch',
    data: actualRun === undefined ? { reason } : { reason, actualRun },
  };
}

export function formatForegroundRunMismatchError(problem: ForegroundRunMismatchProblem): string {
  return `foreground-run-mismatch: ${problem.data.reason}`;
}

export function isForegroundRunActiveError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('run-active:');
}

/**
 * Compare a prompt's foreground precondition against Host actual state.
 * Does not mutate runs. A reserved or cancelling transition is `transitioning`.
 */
export function evaluatePromptForegroundAdmission(input: {
  admission: PromptForegroundAdmission;
  existingRun: ExecutionRunRecord | undefined;
  reserved: boolean;
}): ForegroundRunMismatchProblem | undefined {
  const { admission, existingRun, reserved } = input;
  if (reserved) {
    return createForegroundRunMismatch('transitioning', existingRun);
  }
  if (admission.kind === 'if-idle') {
    if (existingRun === undefined) {
      return undefined;
    }
    if (existingRun.status === 'cancelling') {
      return createForegroundRunMismatch('transitioning', existingRun);
    }
    return createForegroundRunMismatch('active', existingRun);
  }
  if (existingRun === undefined) {
    return createForegroundRunMismatch('already-finished');
  }
  if (existingRun.runId !== admission.runId) {
    return createForegroundRunMismatch('changed', existingRun);
  }
  if (existingRun.status === 'cancelling') {
    return createForegroundRunMismatch('transitioning', existingRun);
  }
  return undefined;
}
