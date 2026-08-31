/**
 * piwin Live — public Host/Desktop types (ADR 0065 + 2026-08-29 provider adapter).
 * No upstream URLs, JWT, SDP, tokens, or raw vendor event shapes on status/push.
 */

export type LiveMediaKind = 'webrtc-sdp' | 'pcm-websocket';

export type LiveMediaDriverId = 'codex-webrtc-v1' | 'gemini-live-v1beta' | 'openai-realtime-ws-v1';

export const LIVE_MEDIA_DRIVER_IDS = [
  'codex-webrtc-v1',
  'gemini-live-v1beta',
  'openai-realtime-ws-v1',
] as const;

export type LiveProviderId = string;

export type LiveCallPhase = 'starting' | 'active' | 'reconnecting' | 'ending' | 'ended' | 'failed';

export type LiveCallActivity =
  | 'listening'
  | 'user-speaking'
  | 'assistant-speaking'
  | 'muted'
  | 'agent-working'
  | 'waiting-for-permission';

export type LiveCallErrorCode =
  | 'live-disabled'
  | 'live-provider-auth'
  | 'live-provider-unavailable'
  | 'live-microphone-denied'
  | 'live-media-unsupported'
  | 'live-call-busy'
  | 'live-session-unavailable'
  | 'live-provider-access-denied'
  | 'live-provider-rejected'
  | 'live-start-throttled'
  | 'live-protocol-failed'
  | 'live-owner-disconnected'
  | 'live-delegation-duplicate'
  | 'live-delegation-rejected'
  | 'live-conflict'
  | 'live-not-owner';

export const LIVE_CALL_ERROR_CODES = [
  'live-disabled',
  'live-provider-auth',
  'live-provider-unavailable',
  'live-microphone-denied',
  'live-media-unsupported',
  'live-call-busy',
  'live-session-unavailable',
  'live-provider-access-denied',
  'live-provider-rejected',
  'live-start-throttled',
  'live-protocol-failed',
  'live-owner-disconnected',
  'live-delegation-duplicate',
  'live-delegation-rejected',
  'live-conflict',
  'live-not-owner',
] as const satisfies readonly LiveCallErrorCode[];

export type LiveReadyMissing =
  | 'provider-auth'
  | 'microphone'
  | 'media-unsupported'
  | 'session'
  | 'call-busy'
  | 'provider-unavailable'
  | 'invalid-settings';

export type LiveProviderAuthView =
  | { kind: 'subscription-oauth'; providerId: string; ready: boolean }
  | { kind: 'api-key'; providerId: string; keyConfigured: boolean };

export type LiveSettingOption = { value: string; label: string };

export type LiveSettingField = {
  key: string;
  control: 'select';
  label: string;
  description?: string;
  required: boolean;
  defaultValue: string;
  options: LiveSettingOption[];
};

export type LiveProviderDescriptor = {
  providerId: LiveProviderId;
  title: string;
  mediaKind: LiveMediaKind;
  mediaDriverId: LiveMediaDriverId;
  auth: LiveProviderAuthView;
  settings: LiveSettingField[];
};

export type LiveSettingsView = {
  revision: number;
  selectedProviderId: LiveProviderId;
  providers: LiveProviderDescriptor[];
};

export type LiveApplySettingsInput = {
  expectedRevision: number;
  providerId: string;
  values: Readonly<Record<string, string>>;
};

export type LiveSetProviderKeyInput = {
  providerId: string;
  operation: 'set' | 'clear';
  key?: string;
};

export type LiveStatusInput = {
  sessionId?: string;
  capabilities: {
    microphone: boolean;
    mediaDriverIds: LiveMediaDriverId[];
  };
};

export type LiveCallView = {
  callId: string;
  revision: number;
  phase: LiveCallPhase;
  activity?: LiveCallActivity;
  boundSessionId: string;
  boundSessionLabel: string;
  ownerDeviceId: string;
  providerId: string;
  mediaDriverId: LiveMediaDriverId;
  voiceModelId: string;
  startedAt: string;
  endedAt?: string;
  errorCode?: LiveCallErrorCode;
};

export type LiveStatusData = {
  ready: boolean;
  selectedProviderId: string;
  settingsRevision: number;
  mediaKind?: LiveMediaKind;
  mediaDriverId?: LiveMediaDriverId;
  missing: LiveReadyMissing[];
  call: LiveCallView | null;
};

export type LiveClientBootstrapInput =
  | { mediaDriverId: 'codex-webrtc-v1'; offerSdp: string }
  | { mediaDriverId: 'gemini-live-v1beta' }
  | { mediaDriverId: 'openai-realtime-ws-v1' };

export type LiveStartInput = {
  sessionId: string;
  providerId: string;
  settingsRevision: number;
  idempotencyKey: string;
  bootstrap: LiveClientBootstrapInput;
};

export type LiveRebindInput = {
  sessionId: string;
  callId: string;
  expectedRevision?: number;
};

export type LiveGeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export type LiveOwnerBootstrap =
  | { mediaDriverId: 'codex-webrtc-v1'; answerSdp: string }
  | {
      mediaDriverId: 'gemini-live-v1beta';
      endpoint: string;
      ephemeralToken: string;
      inputSampleRateHz: 16_000;
      outputSampleRateHz: 24_000;
      modelId: string;
      voice: string;
      thinkingLevel: LiveGeminiThinkingLevel;
    }
  | {
      mediaDriverId: 'openai-realtime-ws-v1';
      /** `wss://…/v1/realtime?model=…` — Host-derived from the model provider baseUrl. */
      endpoint: string;
      /**
       * Short-lived connect material for the current owner shell (Desktop or
       * authenticated paired Mobile). Gateways without
       * `/realtime/client_secrets` may pass the provider API key; observers
       * never receive this bootstrap.
       */
      bearerToken: string;
      inputSampleRateHz: 24_000;
      outputSampleRateHz: 24_000;
      modelId: string;
      voice: string;
    };

export type LiveStartData = {
  call: LiveCallView;
  bootstrap: LiveOwnerBootstrap;
};

export type LiveMediaStateInput = {
  callId: string;
  expectedRevision: number;
  state: 'active' | 'reconnecting' | 'failed';
};

export type LiveSetMutedInput = {
  callId: string;
  expectedRevision: number;
  muted: boolean;
};

export type LiveEndInput = {
  callId?: string;
  expectedRevision?: number;
  reason: 'user' | 'error' | 'settings' | 'logout' | 'host';
};

export type LiveOwnerEvent =
  | { type: 'delegation'; providerDelegationId: string; instruction: string }
  | { type: 'activity'; activity: 'listening' | 'user-speaking' | 'assistant-speaking' }
  | { type: 'media-active' }
  | { type: 'media-reconnecting' }
  | { type: 'media-failed'; mappedCode?: LiveCallErrorCode }
  | { type: 'media-closed' };

export type LiveReportEventInput = {
  callId: string;
  expectedRevision: number;
  event: LiveOwnerEvent;
};

export type LiveUpdatedPush = {
  type: 'voice/live-updated';
  call: LiveCallView | null;
};

export type LiveContextAppendChannel = 'speakable' | 'commentary';
export type LiveContextAppendTarget = 'session' | 'delegation';

export type LiveOwnerActionPush = {
  type: 'voice/live-owner-action';
  callId: string;
  action: 'release-media' | 'show-error' | 'ack-delegation' | 'append-context';
  errorCode?: LiveCallErrorCode;
  providerDelegationId?: string;
  ok?: boolean;
  runId?: string;
  messageId?: string;
  queueId?: string;
  content?: string;
  channel?: LiveContextAppendChannel;
  target?: LiveContextAppendTarget;
};

export const LIVE_DELEGATION_INSTRUCTION_MAX_BYTES = 8_192;
export const LIVE_SDP_OFFER_MAX_BYTES = 256 * 1024;

export function isLiveMediaDriverId(value: unknown): value is LiveMediaDriverId {
  return (
    value === 'codex-webrtc-v1' ||
    value === 'gemini-live-v1beta' ||
    value === 'openai-realtime-ws-v1'
  );
}

export function isLiveCallErrorCode(value: unknown): value is LiveCallErrorCode {
  return typeof value === 'string' && (LIVE_CALL_ERROR_CODES as readonly string[]).includes(value);
}

export function isLiveOwnerEvent(value: unknown): value is LiveOwnerEvent {
  if (!value || typeof value !== 'object') return false;
  const record = value as { type?: unknown };
  if (record.type === 'delegation') {
    const event = value as { providerDelegationId?: unknown; instruction?: unknown };
    return typeof event.providerDelegationId === 'string' && typeof event.instruction === 'string';
  }
  if (record.type === 'activity') {
    const activity = (value as { activity?: unknown }).activity;
    return (
      activity === 'listening' || activity === 'user-speaking' || activity === 'assistant-speaking'
    );
  }
  if (record.type === 'media-failed') return true;
  return (
    record.type === 'media-active' ||
    record.type === 'media-reconnecting' ||
    record.type === 'media-closed'
  );
}

export function validateLiveSettingFields(
  fields: readonly LiveSettingField[],
): { ok: true } | { ok: false; message: string } {
  const keys = new Set<string>();
  for (const field of fields) {
    if (field.control !== 'select')
      return { ok: false, message: `unsupported control ${field.control}` };
    if (keys.has(field.key)) return { ok: false, message: `duplicate field ${field.key}` };
    keys.add(field.key);
    const values = new Set<string>();
    for (const option of field.options) {
      if (values.has(option.value))
        return { ok: false, message: `duplicate option ${field.key}.${option.value}` };
      values.add(option.value);
    }
    if (!values.has(field.defaultValue)) {
      return { ok: false, message: `default ${field.defaultValue} missing from ${field.key}` };
    }
  }
  return { ok: true };
}

export function validateLiveApplyValues(
  fields: readonly LiveSettingField[],
  values: Readonly<Record<string, string>>,
):
  | { ok: true; normalized: Record<string, string> }
  | { ok: false; field?: string; message: string } {
  const allowed = new Map(fields.map((field) => [field.key, field]));
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) return { ok: false, field: key, message: `unknown field ${key}` };
  }
  const normalized: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.key] ?? (field.required ? undefined : field.defaultValue);
    if (raw === undefined) return { ok: false, field: field.key, message: `missing ${field.key}` };
    if (!field.options.some((option) => option.value === raw)) {
      return { ok: false, field: field.key, message: `invalid ${field.key}` };
    }
    normalized[field.key] = raw;
  }
  return { ok: true, normalized };
}
