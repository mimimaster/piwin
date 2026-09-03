import type { Dispatch } from 'react';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { ChatUiAction } from '../chat-reducer';
import { parsePendingPermissionList } from '../permission-queue';

export type PendingPermissionHostClient = {
  supportsCommand?(type: HostCommand['type']): boolean;
  request(command: HostCommand): Promise<HostResponse>;
};

/**
 * Ask Host for the live permission tickets and merge them into Desktop's queue.
 * No-op when the command is not advertised or the request fails.
 */
export async function reconcilePendingPermissions(input: {
  hostClient: PendingPermissionHostClient;
  dispatch: Dispatch<ChatUiAction>;
}): Promise<void> {
  if (input.hostClient.supportsCommand?.('permission/pending-list') === false) {
    return;
  }
  try {
    const response = await input.hostClient.request({ type: 'permission/pending-list' });
    if (!response.success) {
      return;
    }
    input.dispatch({
      type: 'permission/reconcile',
      permissions: parsePendingPermissionList(response.data),
    });
  } catch {
    // Best-effort self-heal; live permission/request pushes remain the source of truth.
  }
}
