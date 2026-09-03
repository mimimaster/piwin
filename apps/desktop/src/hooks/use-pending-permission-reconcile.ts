import { useEffect } from 'react';
import type { Dispatch } from 'react';
import type { ChatUiAction } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { reconcilePendingPermissions } from './reconcile-pending-permissions';

/**
 * Recover pending permission tickets after Host reconnects. Sequence-gap
 * recovery is owned by `useRunReconcile`; this hook covers the ready edge.
 */
export function usePendingPermissionReconcile(input: {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  hostReady: boolean;
}): void {
  const { hostClient, dispatch, hostReady } = input;
  useEffect(() => {
    if (!hostReady) {
      return;
    }
    void reconcilePendingPermissions({ hostClient, dispatch });
  }, [dispatch, hostClient, hostReady]);
}
