import {
  LiveProviderRegistry,
  createFakeCodexRegistration,
  type FakeRealtimeVoiceAdapterControls,
} from '@piwin/voice';
import {
  LiveCallCoordinator,
  type LiveCoordinatorDeps,
} from './live-call-coordinator.js';
import type { LiveChannelSnapshot } from './live-settings-service.js';
import { createVoiceDelegationAdmission } from './voice-delegation-admission.js';

export function readyLiveSnapshot(overrides?: Partial<LiveChannelSnapshot>): LiveChannelSnapshot {
  return {
    revision: 1,
    selectedProviderId: 'openai-codex',
    values: { voice: 'cove' },
    registered: true,
    authReady: true,
    settingsValid: true,
    mediaKind: 'webrtc-sdp',
    mediaDriverId: 'codex-webrtc-v1',
    ...overrides,
  };
}

export function makeLiveCoordinator(
  overrides?: Partial<LiveCoordinatorDeps> & {
    fakeControls?: FakeRealtimeVoiceAdapterControls;
    snapshot?: LiveChannelSnapshot;
  },
): LiveCallCoordinator {
  const fake = createFakeCodexRegistration(overrides?.fakeControls ?? { autoReady: false });
  const { fakeControls: _controls, snapshot, ...deps } = overrides ?? {};
  return new LiveCallCoordinator({
    registry: new LiveProviderRegistry([fake]),
    resolveSnapshot: async () => snapshot ?? readyLiveSnapshot(),
    resolveSessionLabel: () => 'Work',
    review: async (request) => ({ kind: 'repeat', brief: request.instruction }),
    admission: createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt: {
        admitVoiceDelegation: async () => ({
          queued: false,
          runId: 'r1',
          messageId: 'm1',
        }),
      },
    }),
    getFakeAdapter: () => fake.lastAdapter(),
    ...deps,
  });
}
