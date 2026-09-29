/**
 * Binds TurnChangesProvider to the desktop HostClient; a Host without the
 * turn-change read commands leaves the transcript on the per-call summary.
 */
import { useCallback, type ReactElement, type ReactNode } from 'react';
import type { HostPush } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { TurnChangesProvider, type TurnChangesRequest } from './turn-changes-context.js';

export function TurnChangesHostProvider(props: {
  hostClient: HostClient;
  children: ReactNode;
}): ReactElement {
  const { hostClient } = props;
  const request = useCallback<TurnChangesRequest>(
    (command, options) => hostClient.request(command, options),
    [hostClient],
  );
  const subscribePush = useCallback(
    (listener: (push: HostPush) => void) =>
      hostClient.subscribe((message) => {
        if (message.type === 'turn-changes/updated') listener(message);
      }),
    [hostClient],
  );
  if (!hostClient.supportsCommand('turn-changes/list-by-runs')) {
    return <>{props.children}</>;
  }
  return (
    <TurnChangesProvider request={request} subscribePush={subscribePush}>
      {props.children}
    </TurnChangesProvider>
  );
}
