import { useEffect, useRef, useState } from 'react';
import type { FlashcardStudyMode, FlashcardStudyScope } from '@piwin/contracts';
import {
  type FlashcardStudyController,
  type FlashcardStudyViewModel,
} from '@piwin/host-client';
import {
  createDesktopFlashcardStudyController,
  type FlashcardStudyPorts,
} from './study-session';
import { saveStudyResumePointer } from './study-return-context';

export type FlashcardStudyEntry = {
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  resumeExisting: boolean;
  roundId?: string;
};

export function useFlashcardStudy(
  entry: FlashcardStudyEntry,
  ports: FlashcardStudyPorts,
): {
  view: FlashcardStudyViewModel;
  controller: FlashcardStudyController | null;
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
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const scopeKey = JSON.stringify(entry.scope);

  useEffect(() => {
    const session = createDesktopFlashcardStudyController(portsRef.current);
    setController(session);
    const unsubscribe = session.subscribe(setView);
    const currentPorts = portsRef.current;
    const unsubscribePush = currentPorts.subscribePush?.((push) => session.handlePush(push));
    const unsubscribeConnected = currentPorts.subscribeConnected?.((connected) => {
      session.setConnected(connected);
    });
    void (async () => {
      if (entry.roundId) {
        await session.open(entry.roundId);
        return;
      }
      await session.start({
        mode: entry.mode,
        scope: JSON.parse(scopeKey) as typeof entry.scope,
        resumeExisting: entry.resumeExisting,
      });
    })();
    return () => {
      unsubscribe();
      unsubscribePush?.();
      unsubscribeConnected?.();
      setController(null);
    };
  }, [entry.mode, entry.resumeExisting, entry.roundId, scopeKey]);

  useEffect(() => {
    const snapshot = view.snapshot;
    if (!snapshot) return;
    saveStudyResumePointer({
      mode: snapshot.round.mode,
      scope: snapshot.round.scope,
      roundId: snapshot.round.roundId,
    });
  }, [view.snapshot]);

  return { view, controller };
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
