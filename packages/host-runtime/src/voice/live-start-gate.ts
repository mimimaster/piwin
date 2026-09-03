import type {
  LiveCallErrorCode,
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
} from '@piwin/contracts';
import { LIVE_SDP_OFFER_MAX_BYTES } from '@piwin/contracts';
import type { LiveChannelSnapshot } from './live-settings-service.js';

export type LiveStartIdentity = {
  idempotencyKey: string;
  ownerDeviceId: string;
  sessionId: string;
  providerId: string;
};

export type LiveStartGateSlot = LiveStartIdentity & {
  ownerBootstrap: LiveOwnerBootstrap | null;
};

export type LiveStartGateDecision =
  | { kind: 'replay'; bootstrap: LiveOwnerBootstrap }
  | { kind: 'join-inflight' }
  | { kind: 'reject'; errorCode: LiveCallErrorCode }
  | { kind: 'proceed' };

export function decideLiveStart(input: {
  slot: LiveStartGateSlot | null;
  startInFlight: LiveStartIdentity | null;
  request: LiveStartIdentity;
}): LiveStartGateDecision {
  if (input.slot) {
    if (input.slot.ownerDeviceId !== input.request.ownerDeviceId) {
      return { kind: 'reject', errorCode: 'live-call-busy' };
    }
    if (input.slot.idempotencyKey === input.request.idempotencyKey) {
      if (
        input.slot.sessionId !== input.request.sessionId ||
        input.slot.providerId !== input.request.providerId
      ) {
        return { kind: 'reject', errorCode: 'live-conflict' };
      }
      if (input.slot.ownerBootstrap) {
        return { kind: 'replay', bootstrap: input.slot.ownerBootstrap };
      }
    }
  }
  if (input.startInFlight) {
    if (
      input.startInFlight.idempotencyKey === input.request.idempotencyKey &&
      input.startInFlight.ownerDeviceId === input.request.ownerDeviceId
    ) {
      if (
        input.startInFlight.sessionId !== input.request.sessionId ||
        input.startInFlight.providerId !== input.request.providerId
      ) {
        return { kind: 'reject', errorCode: 'live-conflict' };
      }
      return { kind: 'join-inflight' };
    }
    return { kind: 'reject', errorCode: 'live-call-busy' };
  }
  return { kind: 'proceed' };
}

/**
 * Validates the settings snapshot and the shell's media offer against what the
 * request claims. Returns the blocking error code, or `undefined` when the
 * request may proceed to provider creation.
 */
export function findLiveStartPrerequisiteFailure(input: {
  snapshot: LiveChannelSnapshot;
  settingsRevision: number;
  bootstrap: LiveClientBootstrapInput;
}): LiveCallErrorCode | undefined {
  const { snapshot, bootstrap } = input;
  if (input.settingsRevision !== snapshot.revision) return 'live-conflict';
  if (!snapshot.registered) return 'live-provider-unavailable';
  if (!snapshot.authReady) return 'live-provider-auth';
  if (!snapshot.settingsValid) return 'live-protocol-failed';
  if (snapshot.mediaDriverId && bootstrap.mediaDriverId !== snapshot.mediaDriverId) {
    return 'live-media-unsupported';
  }
  if (bootstrap.mediaDriverId === 'codex-webrtc-v1') {
    const offerBytes = new TextEncoder().encode(bootstrap.offerSdp).byteLength;
    if (offerBytes > LIVE_SDP_OFFER_MAX_BYTES) return 'live-protocol-failed';
  }
  return undefined;
}
