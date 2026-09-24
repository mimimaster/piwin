import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  requestTranscriptTurnMeasure,
  transcriptTurnBodyFromFold,
} from './transcript-turn-measure.js';
import { useTranscriptScrollPort } from './transcript-scroll-port.js';

/**
 * Local call-chain / thinking / assembly folds change turn height without
 * touching turnsStructureKey. Remeasure the virtualizer slot after toggle.
 * User toggles also suppress follow-tail stick so expand does not yank the
 * viewport to the live bottom (the “fold refresh” jump). Opening a fold by
 * hand also leaves follow-tail: the settle window only covers the first
 * remasure, and later growth (stream tokens, highlighting inside the opened
 * rows) would otherwise pin to the end and push the header the user just
 * clicked off screen, leaving no way to close it. Automatic folds (live
 * command output, error / diff auto-expand) still follow the tail, or the
 * growth lands below the viewport while the user is watching the stream.
 */
export function useTranscriptLocalFoldMeasure(open: boolean): {
  setRoot: (node: HTMLElement | null) => void;
  onUserToggle: () => void;
} {
  const rootRef = useRef<HTMLElement | null>(null);
  const skipFirstRef = useRef(true);
  const userToggledRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const scrollPort = useTranscriptScrollPort();

  useLayoutEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    requestTranscriptTurnMeasure(transcriptTurnBodyFromFold(rootRef.current));
    if (userToggledRef.current) {
      userToggledRef.current = false;
      return;
    }
    scrollPort?.notifyContentGrew();
  }, [open]);

  const setRoot = useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
  }, []);

  const onUserToggle = useCallback(() => {
    userToggledRef.current = true;
    scrollPort?.beginLocalFoldLayout();
    if (!openRef.current) scrollPort?.detachFromTail();
  }, [scrollPort]);

  return { setRoot, onUserToggle };
}
