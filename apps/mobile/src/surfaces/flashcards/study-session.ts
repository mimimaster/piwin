import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import {
  createFlashcardStudyController,
  type FlashcardStudyController,
  type FlashcardStudyPendingStore,
  type HostRequestOptions,
} from '@piwin/host-client';
import { FLASHCARD_TEAR_DURATION_MS } from '@piwin/ui-kit';
import { createMobileFlashcardStudyPendingStore } from './study-pending-store.js';

export type FlashcardStudyRequest = (
  command: HostCommand,
  options?: HostRequestOptions,
) => Promise<HostResponse>;

export type MobileFlashcardStudyPorts = {
  request: FlashcardStudyRequest;
  subscribePush?: (listener: (push: HostPush) => void) => () => void;
  subscribeConnected?: (listener: (connected: boolean) => void) => () => void;
  hasStudyCapability?: () => boolean;
  hostIdentity?: string;
  pending?: FlashcardStudyPendingStore;
};

function browserClock() {
  return {
    now: () => Date.now(),
    setTimeout: (handler: () => void, ms: number) => window.setTimeout(handler, ms),
    clearTimeout: (id: number) => {
      window.clearTimeout(id);
    },
  };
}

function documentVisibility() {
  return {
    isVisible: () => document.visibilityState !== 'hidden',
    subscribe: (listener: (visible: boolean) => void) => {
      const onChange = () => listener(document.visibilityState !== 'hidden');
      const onHide = () => listener(false);
      const onShow = () => listener(true);
      document.addEventListener('visibilitychange', onChange);
      window.addEventListener('pagehide', onHide);
      window.addEventListener('pageshow', onShow);
      return () => {
        document.removeEventListener('visibilitychange', onChange);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onShow);
      };
    },
  };
}

export function createMobileFlashcardStudyController(
  ports: MobileFlashcardStudyPorts,
): FlashcardStudyController {
  return createFlashcardStudyController({
    request: ports.request,
    pending: ports.pending ?? createMobileFlashcardStudyPendingStore(),
    clock: browserClock(),
    visibility: documentVisibility(),
    tearFallbackMs: FLASHCARD_TEAR_DURATION_MS + 50,
    ...(ports.hasStudyCapability ? { hasStudyCapability: ports.hasStudyCapability } : {}),
    ...(ports.hostIdentity ? { hostIdentity: ports.hostIdentity } : {}),
  });
}
