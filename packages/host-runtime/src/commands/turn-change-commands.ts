/** Host IPC stubs for turn-change commands until undo storage lands. */

import type { HostCommand, HostResponse } from '@piwin/contracts';
import { fail } from '../response-helpers.js';

const TYPES = new Set<HostCommand['type']>([
  'turn-changes/get',
  'turn-changes/list-by-runs',
  'turn-changes/files',
  'turn-changes/diff',
  'turn-changes/check',
  'turn-changes/undo',
  'turn-changes/redo',
  'turn-changes/operation',
  'turn-changes/operations',
  'turn-changes/cancel',
  'turn-changes/recovery-preview',
  'turn-changes/recovery-run',
  'turn-changes/recovery-verify',
]);

/** Capture, storage, and undo writes are not implemented yet. */
function unsupportedCapability(
  requestId: string | undefined,
  commandType: string,
): HostResponse {
  return fail(requestId, commandType, 'unsupported-capability', { code: 'unsupported-capability' });
}

export function isTurnChangeCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleTurnChangeCommand(
  command: HostCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  if (!isTurnChangeCommand(command)) return null;
  return unsupportedCapability(requestId, command.type);
}
