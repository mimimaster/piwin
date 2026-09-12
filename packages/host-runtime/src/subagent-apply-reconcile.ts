/**
 * Recover journaled subagent-apply operations before result projections.
 * Reservation-only rows stay applying so overlapping applies stay rejected.
 */
import {
  recoverTurnChangeOperation,
  type TurnChangeObjectStore,
  type TurnChangeStore,
} from '@piwin/git';
import type { SubagentResultService } from './subagent-result-service.js';

export async function recoverSubagentApplyOperations(input: {
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
}): Promise<void> {
  for (const operation of input.store.listOperationsByKind('subagent-apply')) {
    if (operation.status !== 'applying') continue;
    const files = input.store.listOperationFiles(operation.operationId);
    if (files.length === 0) continue;
    if (files.every((file) => file.status === 'verified')) {
      input.store.updateOperationStatus(operation.operationId, 'succeeded');
      continue;
    }
    const attempt = input.store.getAttempt(operation.changeSetId);
    const workspace = attempt ? input.store.getWorkspace(attempt.workspaceId) : undefined;
    if (!workspace) continue;
    const recovered = await recoverTurnChangeOperation({
      workspaceRoot: workspace.rootPath,
      store: input.store,
      objectStore: input.objectStore,
      operationId: operation.operationId,
    });
    if (recovered.status === 'rolled-back') {
      input.store.releaseSubagentApplyReservation(operation.operationId);
    }
  }
}

export function projectSubagentApplyReservations(
  resultService: Pick<SubagentResultService, 'reconcileApplyReservations'>,
  store: Pick<TurnChangeStore, 'listSubagentApplyReservations'>,
): void {
  resultService.reconcileApplyReservations(store.listSubagentApplyReservations());
}

export async function reconcileSubagentApplyOperations(input: {
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
  resultService?: Pick<SubagentResultService, 'reconcileApplyReservations'>;
}): Promise<void> {
  await recoverSubagentApplyOperations(input);
  if (input.resultService) {
    projectSubagentApplyReservations(input.resultService, input.store);
  }
}
