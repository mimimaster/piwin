import type { LiveReadyMissing, LiveStatusData } from '@piwin/contracts';

export function emptyLiveStatus(current: LiveStatusData | null): LiveStatusData {
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

export function adoptLiveStatus(
  current: LiveStatusData | null,
  incoming: LiveStatusData,
): LiveStatusData {
  const currentCall = current?.call;
  const call =
    currentCall &&
    incoming.call &&
    currentCall.callId === incoming.call.callId &&
    currentCall.revision > incoming.call.revision
      ? currentCall
      : incoming.call;
  return { ...incoming, call, missing: withoutLiveCallBusy(incoming.missing) };
}

export function withoutLiveCallBusy(missing: readonly LiveReadyMissing[]): LiveReadyMissing[] {
  return missing.filter((item) => item !== 'call-busy');
}

export function isLiveStatusData(value: unknown): value is LiveStatusData {
  if (!value || typeof value !== 'object') return false;
  const record = value as {
    ready?: unknown;
    selectedProviderId?: unknown;
    settingsRevision?: unknown;
    missing?: unknown;
    call?: unknown;
  };
  return (
    typeof record.ready === 'boolean' &&
    typeof record.selectedProviderId === 'string' &&
    typeof record.settingsRevision === 'number' &&
    Array.isArray(record.missing) &&
    (record.call === null || (typeof record.call === 'object' && record.call !== null))
  );
}
