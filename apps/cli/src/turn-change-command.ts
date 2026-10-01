/**
 * CLI turn-change undo/redo/show. Same HostCommand as Desktop/remote.
 * Undo and redo are gestures: each carries its own idempotency key, which an
 * attached (remote) Host requires and a retry must reuse.
 */
import type {
  HostCommand,
  HostResponse,
  TurnChangeBackupExport,
  TurnChangeOperationEntry,
  TurnChangeOperationPage,
  TurnChangePathConflict,
  TurnChangeRepairPreview,
  TurnChangeSummary,
} from '@piwin/contracts';
import { newCliGestureKey, type CliHostRequestOptions } from './cli-host.js';

export type TurnChangeHostClient = {
  handleCommand: (command: HostCommand, options?: CliHostRequestOptions) => Promise<HostResponse>;
};

type DirectionResult = {
  operationId?: string;
  status?: string;
  reason?: string;
  affectedPaths?: string[];
  /** Undo: command-created files that changed since the turn and were left alone. */
  skippedPaths?: string[];
  conflicts?: TurnChangePathConflict[];
};

const REFUSAL_TEXT: Record<string, string> = {
  'files-changed': 'files changed after the turn; nothing was modified',
  'staged-paths': 'paths are staged or unmerged in Git; unstage or resolve first (undo never touches the index)',
  'backup-failed': 'its backup data is not available; nothing was modified',
  'permission-denied': 'the Host cannot read or write these paths; nothing was modified',
  'write-failed': 'a write failed and was rolled back; files are as before',
  'needs-repair': 'a write failed and could not roll back; run `piwin turn repair`',
  cancelled: 'cancelled before the first write; nothing was modified',
};

/** One line per blocked path: who changed it after the turn, or that nobody recorded did. */
function describeConflicts(conflicts: readonly TurnChangePathConflict[], write: (line: string) => void): void {
  for (const conflict of conflicts) {
    const later = conflict.laterTurns;
    write(
      later.length === 0
        ? `  ${conflict.relativePath}: source unknown (not changed by a recorded turn)`
        : `  ${conflict.relativePath}: changed later by ${later
            .map((turn) => `${turn.changeSetId} (session ${turn.sessionId})`)
            .join(', ')}`,
    );
  }
}

/** Undo/redo can answer success yet not apply (conflict, rollback, cancel): say so and fail. */
function reportDirection(direction: 'undo' | 'redo', data: DirectionResult, write: (line: string) => void): void {
  const status = data.status ?? 'accepted';
  write(`${direction} ${status} ${data.operationId ?? ''}`.trim());
  if (status === 'succeeded') {
    if ((data.skippedPaths?.length ?? 0) > 0) {
      write(`left in place (created by commands, changed since): ${formatPaths(data.skippedPaths ?? [])}`);
    }
    return;
  }
  if (data.conflicts && data.conflicts.length > 0) describeConflicts(data.conflicts, write);
  const paths = data.affectedPaths ?? [];
  const detail = paths.length > 0 && !data.conflicts?.length ? `: ${paths.join(', ')}` : '';
  const reason = data.reason ?? status;
  const explained = REFUSAL_TEXT[reason];
  throw new Error(`${direction} not applied (${reason}${explained ? `: ${explained}` : ''})${detail}`);
}

export async function runTurnUndo(
  client: TurnChangeHostClient,
  changeSetId: string,
  expectedRevision: number,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand(
    { type: 'turn-changes/undo', changeSetId, expectedRevision },
    newCliGestureKey(),
  );
  if (!response.success) {
    throw new Error(response.error);
  }
  reportDirection('undo', response.data as DirectionResult, write);
}

export async function runTurnRedo(
  client: TurnChangeHostClient,
  changeSetId: string,
  expectedRevision: number,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand(
    { type: 'turn-changes/redo', changeSetId, expectedRevision },
    newCliGestureKey(),
  );
  if (!response.success) {
    throw new Error(response.error);
  }
  reportDirection('redo', response.data as DirectionResult, write);
}

function formatOperation(entry: TurnChangeOperationEntry): string {
  return [
    entry.operationId,
    `${entry.direction} ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}`,
    `change set ${entry.changeSetId} rev ${String(entry.revision)}`,
    `${String(entry.fileCount)} files`,
    entry.createdAt ?? 'time unknown',
    ...(entry.superseded ? ['superseded'] : []),
  ].join(' · ');
}

/** The workspace's undo/redo record, newest first. */
export async function runTurnOperations(
  client: TurnChangeHostClient,
  projectPath: string,
  write: (line: string) => void,
): Promise<void> {
  let cursor: string | null = null;
  let count = 0;
  do {
    const response = await client.handleCommand({
      type: 'turn-changes/operations',
      projectPath,
      ...(cursor !== null ? { cursor } : {}),
    });
    if (!response.success) throw new Error(response.error);
    const page = response.data as TurnChangeOperationPage;
    for (const entry of page.operations) write(formatOperation(entry));
    count += page.operations.length;
    cursor = page.nextCursor;
  } while (cursor !== null);
  if (count === 0) write('no undo/redo recorded for this workspace');
}

export async function runTurnOperation(
  client: TurnChangeHostClient,
  operationId: string,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({ type: 'turn-changes/operation', operationId });
  if (!response.success) throw new Error(response.error);
  write(formatOperation(response.data as TurnChangeOperationEntry));
}

export async function runTurnCancel(
  client: TurnChangeHostClient,
  operationId: string,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand(
    { type: 'turn-changes/cancel', operationId },
    newCliGestureKey(),
  );
  if (!response.success) throw new Error(response.error);
  const data = response.data as { status: string; cancelled: boolean; reason?: string };
  write(
    data.cancelled
      ? `cancel requested for ${operationId}`
      : data.reason === 'write-started'
        ? `${operationId} already started writing; it will finish or roll back safely`
        : `${operationId} already ${data.status}`,
  );
}

/**
 * Repair a stuck operation: preview, then (with --yes) restore paths that still
 * hold the operation's writes, then verify. Never overwrites other content.
 */
export async function runTurnRepair(
  client: TurnChangeHostClient,
  operationId: string,
  expectedRevision: number,
  confirm: boolean,
  write: (line: string) => void,
): Promise<void> {
  const previewResponse = await client.handleCommand({
    type: 'turn-changes/recovery-preview',
    operationId,
    expectedRevision,
  });
  if (!previewResponse.success) throw new Error(previewResponse.error);
  const preview = previewResponse.data as TurnChangeRepairPreview;
  for (const file of preview.files) write(`${file.state.padEnd(17)} ${file.relativePath}`);
  if (!confirm) {
    write('re-run with --yes to restore the operation-content paths');
    return;
  }
  const runResponse = await client.handleCommand(
    {
      type: 'turn-changes/recovery-run',
      operationId,
      expectedRevision,
      confirmationToken: preview.confirmationToken,
    },
    newCliGestureKey(),
  );
  if (!runResponse.success) throw new Error(runResponse.error);
  const verifyResponse = await client.handleCommand({
    type: 'turn-changes/recovery-verify',
    operationId,
    expectedRevision,
  });
  if (!verifyResponse.success) throw new Error(verifyResponse.error);
  const verified = verifyResponse.data as { verified: boolean };
  if (!verified.verified) {
    throw new Error('some paths hold other content; resolve them by hand, then run repair again');
  }
  write(`${operationId} repaired`);
}

/**
 * Copy an operation's pre-operation backup to a new directory under
 * `destination` (on the Host machine). Never writes into the workspace.
 */
export async function runTurnExport(
  client: TurnChangeHostClient,
  operationId: string,
  destination: string,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand(
    { type: 'turn-changes/export-backup', operationId, destination },
    newCliGestureKey(),
  );
  if (!response.success) throw new Error(response.error);
  const exported = response.data as TurnChangeBackupExport;
  write(`exported ${String(exported.exportedPaths.length)} files to ${exported.destination}`);
}

function describeAvailability(summary: TurnChangeSummary, direction: 'undo' | 'redo'): string {
  const availability = direction === 'undo' ? summary.undo : summary.redo;
  return availability.allowed ? 'yes' : `no (${availability.reason})`;
}

/** One line per turn change set touched by the given runs. */
export async function runTurnShow(
  client: TurnChangeHostClient,
  sessionId: string,
  runIds: readonly string[],
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({
    type: 'turn-changes/list-by-runs',
    sessionId,
    runIds: [...runIds],
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const { summaries } = response.data as { summaries: TurnChangeSummary[] };
  if (summaries.length === 0) {
    write('no recorded changes for these runs');
    return;
  }
  for (const summary of summaries) {
    const lines = summary.additions === null ? '' : ` +${String(summary.additions)} -${String(summary.deletions ?? 0)}`;
    write(
      [
        `${summary.changeSetId} rev ${String(summary.revision)}`,
        `${summary.captureState}/${summary.disposition}`,
        `${String(summary.fileCount ?? 0)} files${lines}`,
        `undo: ${describeAvailability(summary, 'undo')}`,
        `redo: ${describeAvailability(summary, 'redo')}`,
        ...(summary.incompleteReason ? [`incomplete: ${summary.incompleteReason}`] : []),
        ...((summary.overlappingPaths?.length ?? 0) > 0
          ? [`blocking (a command also changed): ${formatPaths(summary.overlappingPaths ?? [])}`]
          : []),
        ...((summary.excludedPaths?.length ?? 0) > 0
          ? [`not undone (changed by commands): ${formatPaths(summary.excludedPaths ?? [])}`]
          : []),
      ].join(' · '),
    );
  }
}

/** One line per turn: a long path list is the first few plus a count. */
const MAX_LISTED_PATHS = 5;

function formatPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_LISTED_PATHS).join(', ');
  const hidden = paths.length - MAX_LISTED_PATHS;
  return hidden > 0 ? `${shown} (+${String(hidden)} more)` : shown;
}
