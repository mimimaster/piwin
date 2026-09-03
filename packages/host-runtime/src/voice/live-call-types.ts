import type { LiveCallErrorCode, LiveCallView, LiveOwnerBootstrap, LiveStartData, LiveDelegationReviewer, LiveReviewSessionTurn } from '@piwin/contracts';
import type { FakeRealtimeVoiceAdapter, LiveCallState, LiveProviderRegistry } from '@piwin/voice';
import type { LiveChannelSnapshot } from './live-settings-service.js';

export type LiveDelegationAdmissionResult =
  | { status: 'accepted'; messageId: string; queued: false; runId: string }
  | { status: 'accepted'; messageId: string; queued: true; queuedTurnId: string }
  | {
    status: 'rejected';
    reason:
      | LiveCallErrorCode
      | 'live-delegation-held-empty'
      | 'live-delegation-held-mismatch';
  };

export type LiveStartResult = { ok: true } & LiveStartData | { ok: false; errorCode: LiveCallErrorCode };

export type LiveDelegationAdmissionPort = {
  admit(input: {
    callId: string;
    sessionId: string;
    instruction: string;
    providerDelegationId: string;
  }): Promise<LiveDelegationAdmissionResult>;
};

export type LiveCallSlot = {
  callId: string;
  sessionId: string;
  sessionLabel: string;
  ownerDeviceId: string;
  idempotencyKey: string;
  startedAt: string;
  state: LiveCallState;
  muted: boolean;
  providerId: string;
  mediaDriverId: LiveOwnerBootstrap['mediaDriverId'];
  voiceModelId: string;
  ownerBootstrap: LiveOwnerBootstrap | null;
  close: () => Promise<void>;
  startAbort: AbortController;
};

export type LiveCoordinatorDeps = {
  review: LiveDelegationReviewer;
  registry: LiveProviderRegistry;
  resolveSnapshot: (providerId?: string) => Promise<LiveChannelSnapshot>;
  resolveSessionLabel: (sessionId: string) => Promise<string | null> | string | null;
  admission: LiveDelegationAdmissionPort;
  resolveStartupContext?: (sessionId: string, signal: AbortSignal) => Promise<string | null>;
  getRecentTurns?: (sessionId: string) => Promise<readonly LiveReviewSessionTurn[]> | readonly LiveReviewSessionTurn[];
  getFakeAdapter?: () => FakeRealtimeVoiceAdapter | null;
  now?: () => string;
  pushUpdated?: (call: LiveCallView | null) => void;
  pushOwnerAction?: (action: import('@piwin/contracts').LiveOwnerActionPush) => void;
};
