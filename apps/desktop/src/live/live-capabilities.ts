import type {
  LiveCallView,
  LiveMediaDriverId,
  LiveReadyMissing,
  LiveStatusData,
  LiveStatusInput,
} from '@piwin/contracts';

export function withoutLiveCallBusy(
  missing: readonly LiveReadyMissing[],
): LiveReadyMissing[] {
  return missing.filter((item) => item !== 'call-busy');
}

export function desktopLiveCapabilities(): LiveStatusInput['capabilities'] {
  const mediaDriverIds: LiveMediaDriverId[] = [];
  if (typeof RTCPeerConnection === 'function') mediaDriverIds.push('codex-webrtc-v1');
  if (typeof WebSocket === 'function') {
    mediaDriverIds.push('gemini-live-v1beta');
    mediaDriverIds.push('openai-realtime-ws-v1');
  }
  return {
    microphone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
    mediaDriverIds,
  };
}

export function emptyLiveStatus(current?: LiveStatusData | null): LiveStatusData {
  return {
    ready: current?.ready ?? false,
    selectedProviderId: current?.selectedProviderId ?? '',
    settingsRevision: current?.settingsRevision ?? 0,
    missing: withoutLiveCallBusy(current?.missing ?? []),
    call: null,
    ...(current?.mediaKind ? { mediaKind: current.mediaKind } : {}),
    ...(current?.mediaDriverId ? { mediaDriverId: current.mediaDriverId } : {}),
  };
}

/** A stale status fetch must not roll an already-advanced call back to starting. */
export function preferFresherLiveCall(
  current: LiveCallView | null,
  incoming: LiveCallView | null,
): LiveCallView | null {
  if (
    current &&
    incoming &&
    current.callId === incoming.callId &&
    current.revision > incoming.revision
  ) {
    return current;
  }
  return incoming;
}

/** Host includes `call-busy` whenever a slot exists, including our own call. */
export function adoptLiveStatus(
  current: LiveStatusData | null,
  incoming: LiveStatusData,
): LiveStatusData {
  return {
    ...incoming,
    call: preferFresherLiveCall(current?.call ?? null, incoming.call),
    missing: withoutLiveCallBusy(incoming.missing),
  };
}
