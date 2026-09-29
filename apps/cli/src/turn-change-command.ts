/**
 * CLI turn-change undo/redo/show. Same HostCommand as Desktop/remote.
 * Undo and redo are gestures: each carries its own idempotency key, which an
 * attached (remote) Host requires and a retry must reuse.
 */
import type { HostCommand, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import { newCliGestureKey, type CliHostRequestOptions } from './cli-host.js';

export type TurnChangeHostClient = {
  handleCommand: (command: HostCommand, options?: CliHostRequestOptions) => Promise<HostResponse>;
};

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
  const data = response.data as { operationId?: string; status?: string };
  write(`undo ${data.status ?? 'accepted'} ${data.operationId ?? ''}`.trim());
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
  const data = response.data as { operationId?: string; status?: string };
  write(`redo ${data.status ?? 'accepted'} ${data.operationId ?? ''}`.trim());
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
        ...((summary.excludedPaths?.length ?? 0) > 0
          ? [`not undone (changed by commands): ${(summary.excludedPaths ?? []).join(', ')}`]
          : []),
      ].join(' · '),
    );
  }
}
