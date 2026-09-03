/**
 * Owner/identity checks and the client projection for the single live call.
 * Pure helpers so every command applies the same ownership rules.
 */

import type { LiveCallErrorCode, LiveCallView } from '@piwin/contracts';
import type { LiveCallSlot } from './live-call-types.js';

export type LiveCallAccess<Slot> =
  | { ok: true; slot: Slot }
  | { ok: false; errorCode: LiveCallErrorCode };

/**
 * Resolves the slot a command may act on. `expectedRevision` is optional
 * because retarget-style commands accept an unversioned request.
 */
export function accessLiveCall(
  slot: LiveCallSlot | null,
  request: { callId: string; ownerDeviceId: string; expectedRevision?: number },
): LiveCallAccess<LiveCallSlot> {
  if (!slot || slot.callId !== request.callId) {
    return { ok: false, errorCode: 'live-session-unavailable' };
  }
  if (slot.ownerDeviceId !== request.ownerDeviceId) {
    return { ok: false, errorCode: 'live-not-owner' };
  }
  if (request.expectedRevision !== undefined && request.expectedRevision !== slot.state.revision) {
    return { ok: false, errorCode: 'live-conflict' };
  }
  return { ok: true, slot };
}

/** Client-visible call state. Startup summaries and tokens never appear here. */
export function toLiveCallView(slot: LiveCallSlot): LiveCallView {
  return {
    callId: slot.callId,
    revision: slot.state.revision,
    phase: slot.state.phase,
    ...(slot.state.activity ? { activity: slot.state.activity } : {}),
    boundSessionId: slot.sessionId,
    boundSessionLabel: slot.sessionLabel,
    ownerDeviceId: slot.ownerDeviceId,
    providerId: slot.providerId,
    mediaDriverId: slot.mediaDriverId,
    voiceModelId: slot.voiceModelId,
    startedAt: slot.startedAt,
    ...(slot.state.errorCode ? { errorCode: slot.state.errorCode } : {}),
  };
}