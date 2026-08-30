import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import {
  createFlashcardStudyController,
  type FlashcardStudyController,
  type FlashcardStudyPendingStore,
  type HostRequestOptions,
} from '@piwin/host-client';
import { FLASHCARD_TEAR_DURATION_MS } from '@piwin/ui-kit';
import { createDesktopFlashcardStudyPendingStore } from './study-pending-store';

export type FlashcardStudyRequest = (
  command: HostCommand,
  options?: HostRequestOptions,
) => Promise<HostResponse>;

export type FlashcardStudyPorts = {
  request: FlashcardStudyRequest;
  subscribePush?: (listener: (push: HostPush) => void) => () => void;
  subscribeConnected?: (listener: (connected: boolean) => void) => () => void;
  hasStudyCapability?: () => boolean;
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
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
  };
}

export function createDesktopFlashcardStudyController(
  ports: FlashcardStudyPorts,
): FlashcardStudyController {
  return createFlashcardStudyController({
    request: ports.request,
    pending: ports.pending ?? createDesktopFlashcardStudyPendingStore(),
    clock: browserClock(),
    visibility: documentVisibility(),
    tearFallbackMs: FLASHCARD_TEAR_DURATION_MS + 50,
    ...(ports.hasStudyCapability ? { hasStudyCapability: ports.hasStudyCapability } : {}),
  });
}
