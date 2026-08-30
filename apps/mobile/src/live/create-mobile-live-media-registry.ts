import type { LiveMediaDriverId } from '@piwin/contracts';
import { createMobilePcmLiveDriver } from './mobile-pcm-live-driver.js';
import type { MobileLiveMediaDriver } from './mobile-live-media-driver.js';
import { createMobileWebrtcLiveDriver } from './mobile-webrtc-live-driver.js';

export type MobileLiveMediaRegistry = {
  create(driverId: LiveMediaDriverId): MobileLiveMediaDriver;
};

export function createMobileLiveMediaRegistry(): MobileLiveMediaRegistry {
  return {
    create(driverId) {
      switch (driverId) {
        case 'codex-webrtc-v1':
          return createMobileWebrtcLiveDriver();
        case 'gemini-live-v1beta':
        case 'openai-realtime-ws-v1':
          return createMobilePcmLiveDriver(driverId);
        default: {
          const _exhaustive: never = driverId;
          throw new Error(`Unsupported mobile Live driver: ${_exhaustive}`);
        }
      }
    },
  };
}
