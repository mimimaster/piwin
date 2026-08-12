/**
 * CLI helpers for manual session cold storage (R1 PR3).
 * Always talk to one Host authority via handleCommand.
 */
import type {
  HostCommand,
  HostResponse,
  SessionColdStorageExecuteResult,
  SessionColdStoragePlan,
  SessionColdStorageReconcileResult,
  SessionColdStorageRestoreResult,
  SessionColdStorageStatus,
} from '@piwin/contracts';

export type SessionColdStorageHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

export async function runSessionColdStorageStatus(
  client: SessionColdStorageHostClient,
  print: (line: string) => void,
): Promise<SessionColdStorageStatus> {
  return runCommand(client, { type: 'session/cold-storage-status' }, print, formatStatus);
}

export async function runSessionColdStoragePlan(
  client: SessionColdStorageHostClient,
  sessionIds: string[] | undefined,
  print: (line: string) => void,
): Promise<SessionColdStoragePlan> {
  return runCommand(
    client,
    {
      type: 'session/cold-storage-plan',
      ...(sessionIds && sessionIds.length > 0 ? { sessionIds } : {}),
    },
    print,
    formatPlan,
  );
}

export async function runSessionColdStorageExecute(
  client: SessionColdStorageHostClient,
  input: { planId: string; confirmationDigest: string },
  print: (line: string) => void,
): Promise<SessionColdStorageExecuteResult> {
  return runCommand(
    client,
    {
      type: 'session/cold-storage-execute',
      planId: input.planId,
      confirmationDigest: input.confirmationDigest,
    },
    print,
    formatExecute,
  );
}

export async function runSessionColdStorageRestore(
  client: SessionColdStorageHostClient,
  input: { sessionId: string; packPath?: string },
  print: (line: string) => void,
): Promise<SessionColdStorageRestoreResult> {
  return runCommand(
    client,
    {
      type: 'session/cold-storage-restore',
      sessionId: input.sessionId,
      ...(input.packPath ? { packPath: input.packPath } : {}),
    },
    print,
    formatRestore,
  );
}

export async function runSessionColdStorageImport(
  client: SessionColdStorageHostClient,
  packPath: string,
  print: (line: string) => void,
): Promise<SessionColdStorageRestoreResult> {
  return runCommand(
    client,
    { type: 'session/cold-storage-import', packPath },
    print,
    formatRestore,
  );
}

export async function runSessionColdStorageReconcile(
  client: SessionColdStorageHostClient,
  print: (line: string) => void,
): Promise<SessionColdStorageReconcileResult> {
  return runCommand(client, { type: 'session/cold-storage-reconcile' }, print, formatReconcile);
}

async function runCommand<T>(
  client: SessionColdStorageHostClient,
  command: HostCommand,
  print: (line: string) => void,
  format: (data: T) => string,
): Promise<T> {
  const response = await client.handleCommand(command);
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as T;
  print(format(data));
  return data;
}

export function formatStatus(status: SessionColdStorageStatus): string {
  return [
    `enabled: ${status.config.enabled}`,
    `packOutputDir: ${status.config.packOutputDir ?? '(unset)'}`,
    `packOutputDirValid: ${status.packOutputDirValid}`,
    `minArchivedAgeDays: ${status.config.minArchivedAgeDays}`,
    `localPayloadBytes: ${status.localPayloadBytes}`,
    `overBudget: ${status.overBudget}`,
    `eligibleCount: ${status.eligibleCount}`,
    `missingPack: ${status.missingPackSessionIds.join(',') || '(none)'}`,
    `residualTransactions: ${status.residualTransactions.length}`,
  ].join('\n');
}

/** Read-only doctor block. Does not mutate journals. */
export function formatDoctorColdStorageLines(status: SessionColdStorageStatus): string[] {
  const lines = [
    `- enabled: ${status.config.enabled}`,
    `- packOutputDir: ${status.config.packOutputDir ?? '(unset)'}`,
    `- packOutputDirValid: ${status.packOutputDirValid}`,
    `- residual transactions: ${status.residualTransactions.length}`,
  ];
  for (const transaction of status.residualTransactions) {
    lines.push(
      `  · ${transaction.transactionId} session=${transaction.sessionId} kind=${transaction.kind} phase=${transaction.phase}`,
    );
  }
  lines.push(
    `- missing packs: ${status.missingPackSessionIds.join(', ') || '(none)'}`,
  );
  if (status.residualTransactions.length > 0 || status.missingPackSessionIds.length > 0) {
    lines.push(
      '  · run `piwin session cold reconcile` to recover journals and recheck packs',
    );
  }
  if (status.missingPackSessionIds.length > 0) {
    lines.push(
      '  · restore a missing pack with `piwin session cold restore <sessionId> --pack <host-path>`',
    );
  }
  return lines;
}

export function formatPlan(plan: SessionColdStoragePlan): string {
  const lines = [
    `plan ${plan.planId}`,
    `confirm ${plan.confirmationDigest}`,
    `expires ${plan.expiresAt}`,
    `output ${plan.packOutputDir}`,
    `peakBytes ${plan.estimatedPeakBytes}`,
    `targets=${plan.targets.length} skipped=${plan.skipped.length}`,
  ];
  for (const target of plan.targets) {
    lines.push(`${target.sessionId}\t${target.estimatedPayloadBytes}\t${target.name ?? ''}`);
  }
  for (const skipped of plan.skipped) {
    lines.push(`skipped\t${skipped.sessionId}\t${skipped.reason}`);
  }
  if (plan.targets.length > 0) {
    lines.push(
      `execute with: piwin session cold execute --plan ${plan.planId} --confirm ${plan.confirmationDigest}`,
    );
  }
  return lines.join('\n');
}

export function formatExecute(result: SessionColdStorageExecuteResult): string {
  const lines = [
    `plan ${result.planId}`,
    `offloaded=${result.offloaded.length} failed=${result.failed.length}`,
  ];
  for (const item of result.offloaded) {
    lines.push(`offloaded\t${item.sessionId}\t${item.packPath}`);
  }
  for (const item of result.failed) {
    lines.push(`failed\t${item.sessionId}\t${item.error}`);
  }
  return lines.join('\n');
}

export function formatRestore(result: SessionColdStorageRestoreResult): string {
  return [
    `sessionId: ${result.sessionId}`,
    `packId: ${result.packId}`,
    `packPath: ${result.packPath}`,
    `createdIndexRecord: ${result.createdIndexRecord}`,
    `storage: ${result.storage.state}`,
  ].join('\n');
}

export function formatReconcile(result: SessionColdStorageReconcileResult): string {
  const lines = [
    `recovered=${result.recovered.length} updated=${result.updatedSessionIds.length} reports=${result.reports.length}`,
  ];
  for (const item of result.recovered) {
    lines.push(`recovered\t${item.sessionId}\t${item.action}`);
  }
  for (const report of result.reports) {
    lines.push(`report\t${report.kind}\t${report.sessionId ?? '-'}\t${report.detail}`);
  }
  return lines.join('\n');
}
