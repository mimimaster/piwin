import type { LiveMediaDriverId, LiveMediaKind, LiveReadyMissing, LiveStatusInput } from '@piwin/contracts';

export function computeLiveReadiness(input: {
  selectedProviderId: string;
  mediaKind?: LiveMediaKind;
  mediaDriverId?: LiveMediaDriverId;
  providerRegistered: boolean;
  authReady: boolean;
  settingsValid: boolean;
  sessionReady: boolean;
  callBusy: boolean;
  capabilities: LiveStatusInput['capabilities'];
}): { ready: boolean; missing: LiveReadyMissing[] } {
  const missing: LiveReadyMissing[] = [];
  if (!input.providerRegistered) missing.push('provider-unavailable');
  if (!input.authReady) missing.push('provider-auth');
  if (!input.settingsValid) missing.push('invalid-settings');
  if (!input.capabilities.microphone) missing.push('microphone');
  if (input.mediaDriverId && !input.capabilities.mediaDriverIds.includes(input.mediaDriverId)) {
    missing.push('media-unsupported');
  }
  if (!input.sessionReady) missing.push('session');
  if (input.callBusy) missing.push('call-busy');
  return { ready: missing.length === 0, missing };
}
