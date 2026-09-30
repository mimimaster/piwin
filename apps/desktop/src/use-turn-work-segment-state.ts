import { useCallback, useState } from 'react';
import { TURN_WORK_SEGMENT_WINDOW } from './turn-work-segment-plan.js';

export type TurnWorkSegmentState = {
  /** Reader open/closed choices, keyed by segment id. */
  openOverrides: Readonly<Record<string, boolean>>;
  windowSizeFor: (foldKey: string) => number;
  toggleSegment: (segmentId: string, currentlyOpen: boolean) => void;
  showEarlier: (foldKey: string) => void;
};

/**
 * Transcript-level segment state. It lives above the virtualized turn list so
 * a turn remounting (scrolled out and back, or re-keyed by a history page)
 * keeps the segments the reader opened.
 */
export function useTurnWorkSegmentState(): TurnWorkSegmentState {
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [windowByFold, setWindowByFold] = useState<Record<string, number>>({});
  const windowSizeFor = useCallback(
    (foldKey: string) => windowByFold[foldKey] ?? TURN_WORK_SEGMENT_WINDOW,
    [windowByFold],
  );
  const toggleSegment = useCallback((segmentId: string, currentlyOpen: boolean) => {
    setOpenOverrides((current) => ({ ...current, [segmentId]: !currentlyOpen }));
  }, []);
  const showEarlier = useCallback((foldKey: string) => {
    setWindowByFold((current) => ({
      ...current,
      [foldKey]: (current[foldKey] ?? TURN_WORK_SEGMENT_WINDOW) + TURN_WORK_SEGMENT_WINDOW,
    }));
  }, []);
  return { openOverrides, windowSizeFor, toggleSegment, showEarlier };
}
