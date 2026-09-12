import { randomUUID } from 'node:crypto';
import type { SubagentIntegrationStatus, SubagentTaskResult } from '@piwin/contracts';
import type {
  SubagentApplyReservationRecord,
  SubagentApplyReserveResult,
  TurnChangeOperationRecord,
} from '@piwin/git';

export type SubagentApplyReservationPort = {
  reserveSubagentApply(input: {
    operationId: string;
    changeSetId: string;
    expectedRevision: number;
    principal: string;
    idempotencyKey: string;
    requestHash: string;
    resultId: string;
    candidateGroupId?: string | null;
  }): SubagentApplyReserveResult;
  releaseSubagentApplyReservation(operationId: string): void;
  updateOperationStatus(operationId: string, status: string): void;
  getOperation(operationId: string): TurnChangeOperationRecord | undefined;
  recordSubagentApplyWriteCompleted?(operationId: string): void;
  hasSubagentApplyWriteCompleted?(operationId: string): boolean;
  getSubagentApplyReservation?(query: {
    resultId?: string;
    candidateGroupId?: string;
  }): SubagentApplyReservationRecord | undefined;
};

export type SubagentApplyWriterStatus = 'succeeded' | 'rejected' | 'needs-repair';

export function subagentApplyIdempotencyKey(resultId: string): string {
  return `subagent-apply:${resultId}`;
}

export function subagentApplyRequestHash(resultId: string, revision: number): string {
  return `${subagentApplyIdempotencyKey(resultId)}:${String(revision)}`;
}

export type IntegrationApplyReservation = {
  blocked: boolean;
  result: SubagentTaskResult;
  release(): void;
  complete(status: 'succeeded' | 'needs-repair'): void;
};

export function idleApplyReservation(): IntegrationApplyReservation {
  return {
    blocked: false,
    result: {
      runId: '',
      taskId: '',
      executionStatus: 'completed',
      summaryStatus: 'not-requested',
      integrationStatus: 'pending',
    },
    release() {},
    complete() {},
  };
}

export function reserveIntegrationApply(
  port: SubagentApplyReservationPort | undefined,
  result: SubagentTaskResult,
): IntegrationApplyReservation {
  const resultRef = result.resultRef;
  if (!port || !resultRef) {
    return idleApplyReservation();
  }
  const reserved = port.reserveSubagentApply({
    operationId: randomUUID(),
    changeSetId: result.childChanges?.changeSetId ?? subagentApplyIdempotencyKey(resultRef.resultId),
    expectedRevision: resultRef.revision,
    principal: 'host',
    idempotencyKey: subagentApplyIdempotencyKey(resultRef.resultId),
    requestHash: subagentApplyRequestHash(resultRef.resultId, resultRef.revision),
    resultId: resultRef.resultId,
    ...(result.candidateGroupId !== undefined ? { candidateGroupId: result.candidateGroupId } : {}),
  });
  if (reserved.outcome === 'conflict') {
    return {
      blocked: true,
      result: {
        ...result,
        integrationStatus: 'failed',
        error: reserved.code,
      },
      release() {},
      complete() {},
    };
  }
  if (reserved.outcome === 'replay' && reserved.status === 'succeeded') {
    return {
      blocked: true,
      result: { ...result, integrationStatus: 'applied' },
      release() {},
      complete() {},
    };
  }
  if (reserved.outcome === 'replay' && reserved.status === 'needs-repair') {
    return {
      blocked: true,
      result: {
        ...result,
        integrationStatus: 'failed',
        error: 'needs-repair',
      },
      release() {},
      complete() {},
    };
  }
  const operationId = reserved.operationId;
  if (
    reserved.outcome === 'replay' &&
    reserved.status === 'applying' &&
    port.hasSubagentApplyWriteCompleted?.(operationId) === true
  ) {
    port.updateOperationStatus(operationId, 'succeeded');
    return {
      blocked: true,
      result: { ...result, integrationStatus: 'applied' },
      release() {},
      complete() {},
    };
  }
  return {
    blocked: false,
    result,
    release() {
      port.releaseSubagentApplyReservation(operationId);
    },
    complete(status) {
      if (status === 'succeeded') {
        port.recordSubagentApplyWriteCompleted?.(operationId);
      }
      port.updateOperationStatus(operationId, status);
    },
  };
}

export function applyStatusFromIntegration(input: {
  integrationStatus: SubagentIntegrationStatus;
  reservationStatus?: string;
}): SubagentApplyWriterStatus {
  if (input.integrationStatus === 'applied') {
    return 'succeeded';
  }
  if (input.integrationStatus === 'conflict' || input.reservationStatus === 'needs-repair') {
    return 'needs-repair';
  }
  return 'rejected';
}
