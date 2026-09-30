/**
 * Binds TurnChangesProvider to the desktop HostClient; a Host without the
 * turn-change read commands leaves the transcript on the per-call summary.
 *
 * Mounted at the workbench root so the transcript cards and the right panel's
 * 本轮变更 view share one index and one focused turn.
 */
import { useCallback, type ReactElement, type ReactNode } from 'react';
import type { HostPush } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { TurnChangesProvider, type TurnChangesRequest } from './turn-changes-context.js';

export function TurnChangesHostProvider(props: {
  hostClient: HostClient;
  /** Open the review tab when a turn card asks to show its changes there. */
  onOpenReview?: () => void;
  children: ReactNode;
}): ReactElement {
  const { hostClient, onOpenReview } = props;
  const request = useCallback<TurnChangesRequest>(
    (command, options) => hostClient.request(command, options),
    [hostClient],
  );
  const subscribePush = useCallback(
    (listener: (push: HostPush) => void) =>
      hostClient.subscribe((message) => {
        if (message.type === 'turn-changes/updated' || message.type === 'turn-changes/operation-updated') {
          listener(message);
        }
      }),
    [hostClient],
  );
  const onFocusChangeSet = useCallback(() => onOpenReview?.(), [onOpenReview]);
  // Same idiom as flashcards: ready now, then every host/status change.
  const subscribeConnected = useCallback(
    (listener: (connected: boolean) => void) => {
      listener(hostClient.isReady());
      return hostClient.subscribe((message) => {
        if (message.type === 'host/status') listener(message.ready);
      });
    },
    [hostClient],
  );
  if (!hostClient.supportsCommand('turn-changes/list-by-runs')) {
    return <>{props.children}</>;
  }
  return (
    <TurnChangesProvider
      request={request}
      subscribePush={subscribePush}
      subscribeConnected={subscribeConnected}
      onFocusChangeSet={onFocusChangeSet}
    >
      {props.children}
    </TurnChangesProvider>
  );
}
