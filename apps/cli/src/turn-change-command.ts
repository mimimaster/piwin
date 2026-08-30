/**
 * CLI turn-change undo/redo. Same HostCommand as Desktop/remote.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';

export type TurnChangeHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

export async function runTurnUndo(
  client: TurnChangeHostClient,
  changeSetId: string,
  expectedRevision: number,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({
    type: 'turn-changes/undo',
    changeSetId,
    expectedRevision,
  });
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
  const response = await client.handleCommand({
    type: 'turn-changes/redo',
    changeSetId,
    expectedRevision,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as { operationId?: string; status?: string };
  write(`redo ${data.status ?? 'accepted'} ${data.operationId ?? ''}`.trim());
}
