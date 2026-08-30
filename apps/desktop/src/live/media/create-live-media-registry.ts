import type { LivePeer } from '../live-peer.js';
import { createCodexWebrtcDriver } from './codex-webrtc-driver.js';
import { createGeminiLiveDriver } from './gemini-live-driver.js';
import { createOpenaiRealtimeDriver } from './openai-realtime-driver.js';
import { DesktopLiveMediaDriverRegistry } from './live-media-driver-registry.js';

export function createDesktopLiveMediaRegistry(input?: {
  createPeer?: () => LivePeer;
}): DesktopLiveMediaDriverRegistry {
  return new DesktopLiveMediaDriverRegistry([
    ['codex-webrtc-v1', () => createCodexWebrtcDriver(input?.createPeer?.())],
    ['gemini-live-v1beta', () => createGeminiLiveDriver()],
    ['openai-realtime-ws-v1', () => createOpenaiRealtimeDriver()],
  ]);
}
