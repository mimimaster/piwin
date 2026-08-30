import { useEffect, useRef, useState } from 'react';
import type { FlashcardStudySnapshot } from '@piwin/contracts';
import {
  type FlashcardStudyController,
  type FlashcardStudyViewModel,
} from '@piwin/host-client';
import {
  createMobileFlashcardStudyController,
  type MobileFlashcardStudyPorts,
} from './study-session.js';

export function useFlashcardStudy(
  roundId: string,
  ports: MobileFlashcardStudyPorts,
): {
  view: FlashcardStudyViewModel;
  controller: FlashcardStudyController | null;
  facesConcealed: boolean;
} {
  const [view, setView] = useState<FlashcardStudyViewModel>({
    phase: 'loading',
    snapshot: null,
    error: null,
    transitionId: null,
    connected: true,
    pendingConfirmation: false,
    readOnly: false,
  });
  const [controller, setController] = useState<FlashcardStudyController | null>(null);
  const [facesConcealed, setFacesConcealed] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const portsRef = useRef(ports);
  portsRef.current = ports;

  useEffect(() => {
    const session = createMobileFlashcardStudyController(portsRef.current);
    setController(session);
    const unsubscribe = session.subscribe(setView);
    const currentPorts = portsRef.current;
    const unsubscribePush = currentPorts.subscribePush?.((push) => session.handlePush(push));
    const unsubscribeConnected = currentPorts.subscribeConnected?.((connected) => {
      session.setConnected(connected);
    });
    void session.open(roundId);
    return () => {
      unsubscribe();
      unsubscribePush?.();
      unsubscribeConnected?.();
      setController(null);
    };
  }, [roundId]);

  useEffect(() => {
    const conceal = (): void => {
      setFacesConcealed(true);
    };
    const reveal = (): void => {
      setFacesConcealed(document.visibilityState === 'hidden');
      if (document.visibilityState !== 'hidden') {
        void controller?.open(roundId);
      }
    };
    document.addEventListener('visibilitychange', reveal);
    window.addEventListener('pagehide', conceal);
    window.addEventListener('pageshow', reveal);
    return () => {
      document.removeEventListener('visibilitychange', reveal);
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('pageshow', reveal);
    };
  }, [controller, roundId]);

  return { view, controller, facesConcealed };
}

export async function pauseThenLeave(
  controller: FlashcardStudyController | null,
  onLeave: () => void,
): Promise<void> {
  const phase = controller?.getViewModel().phase;
  if (
    controller &&
    phase !== 'completed' &&
    phase !== 'paused' &&
    phase !== 'loading' &&
    phase !== 'error'
  ) {
    await controller.pause();
  }
  onLeave();
}

export function snapshotRoundId(snapshot: FlashcardStudySnapshot | null): string | undefined {
  return snapshot?.round.roundId;
}
