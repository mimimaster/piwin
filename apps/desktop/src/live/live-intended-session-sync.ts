import { useEffect } from 'react';
import type { HostClient } from '../host-client.js';

export async function syncLiveIntendedSession(input: {
  hostClient: HostClient;
  callId: string | null | undefined;
  intendedSessionId: string | null;
}): Promise<void> {
  const callId = input.callId?.trim();
  if (!callId) return;
  await input.hostClient.request({
    type: 'voice/live/set-intended-session',
    input: { callId, intendedSessionId: input.intendedSessionId },
  });
}

export function useLiveIntendedSessionSync(input: {
  hostClient: HostClient;
  callId: string | null | undefined;
  intendedSessionId: string | null;
}): void {
  const { hostClient, callId, intendedSessionId } = input;
  useEffect(() => {
    void syncLiveIntendedSession({ hostClient, callId, intendedSessionId });
  }, [hostClient, callId, intendedSessionId]);
}
