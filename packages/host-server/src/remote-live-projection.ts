import type { HostCommand, HostResponse, LiveCallView, LiveStatusData } from '@piwin/contracts';
import { redactPersistedMessage } from '@piwin/host-runtime';

export function projectRemoteLiveResponse(
  command: HostCommand,
  response: HostResponse,
  options: { owner?: boolean } = {},
): HostResponse | null {
  if (!command.type.startsWith('voice/live/')) return null;
  if (!response.success) {
    return {
      ...response,
      error: redactPersistedMessage(response.error),
    };
  }
  if (command.type === 'voice/live/start') {
    if (options.owner === true) return response;
    const data = asRecord(response.data);
    const call = data?.call;
    return {
      ...response,
      data: {
        call: isLiveCallView(call) ? call : null,
      },
    };
  }
  if (command.type === 'voice/live/status') {
    return { ...response, data: projectLiveStatus(response.data) };
  }
  return response;
}

function projectLiveStatus(data: unknown): LiveStatusData {
  const record = asRecord(data);
  const missing = Array.isArray(record?.missing)
    ? record.missing.filter((item): item is LiveStatusData['missing'][number] => typeof item === 'string')
    : [];
  return {
    ready: record?.ready === true,
    selectedProviderId:
      typeof record?.selectedProviderId === 'string' ? record.selectedProviderId : 'openai-codex',
    settingsRevision: typeof record?.settingsRevision === 'number' ? record.settingsRevision : 0,
    missing,
    call: isLiveCallView(record?.call) ? record.call : null,
    ...(record?.mediaKind === 'webrtc-sdp' || record?.mediaKind === 'pcm-websocket'
      ? { mediaKind: record.mediaKind }
      : {}),
    ...(record?.mediaDriverId === 'codex-webrtc-v1' ||
    record?.mediaDriverId === 'gemini-live-v1beta' ||
    record?.mediaDriverId === 'openai-realtime-ws-v1'
      ? { mediaDriverId: record.mediaDriverId }
      : {}),
  };
}

function isLiveCallView(value: unknown): value is LiveCallView {
  const record = asRecord(value);
  return (
    typeof record?.callId === 'string' &&
    typeof record.revision === 'number' &&
    typeof record.providerId === 'string'
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
