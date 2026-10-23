import type { Dispatch } from 'react';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { ChatUiAction } from '../conversation/chat-reducer';
import { parsePendingPermissionList } from '../settings/permission-queue';

export type PendingPermissionHostClient = {
  supportsCommand?(type: HostCommand['type']): boolean;
  request(command: HostCommand): Promise<HostResponse>;
};

/**
 * Ask Host for the live permission tickets and merge them into Desktop's queue.
 * No-op when the command is not advertised or the request fails.
 *
 * `sessionId` narrows the merge to one session. A pane reducer passes it so the
 * host's global pending list cannot pull other sessions' prompts into that pane.
 */
export async function reconcilePendingPermissions(input: {
  hostClient: PendingPermissionHostClient;
  dispatch: Dispatch<ChatUiAction>;
  sessionId?: string;
}): Promise<void> {
  if (input.hostClient.supportsCommand?.('permission/pending-list') === false) {
    return;
  }
  try {
    const response = await input.hostClient.request({ type: 'permission/pending-list' });
    if (!response.success) {
      return;
    }
    const parsed = parsePendingPermissionList(response.data);
    input.dispatch({
      type: 'permission/reconcile',
      permissions:
        input.sessionId === undefined
          ? parsed
          : parsed.filter((prompt) => prompt.sessionId === input.sessionId),
    });
  } catch {
    // Best-effort self-heal; live permission/request pushes remain the source of truth.
  }
}
