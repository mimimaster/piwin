import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { globalMemoryGovernor, type MemoryPressureLevel } from '../notes/memory-governor.js';
import { resolveTurnWorkSegmentWindow } from '../turn-changes/turn-work-segment-plan.js';

export type TurnWorkSegmentState = {
  /** Reader open/closed choices, keyed by segment id. */
  openOverrides: Readonly<Record<string, boolean>>;
  pressureLevel: MemoryPressureLevel;
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
  const pressureLevel = useSyncExternalStore(
    globalMemoryGovernor.subscribe,
    globalMemoryGovernor.getLevel,
    () => 'normal' as const,
  );
  const baseWindow = resolveTurnWorkSegmentWindow(pressureLevel);
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [windowByFold, setWindowByFold] = useState<Record<string, number>>({});
  useEffect(() => {
    if (pressureLevel === 'critical') {
      setWindowByFold((current) => (Object.keys(current).length === 0 ? current : {}));
    }
  }, [pressureLevel]);
  const windowSizeFor = useCallback(
    (foldKey: string) => windowByFold[foldKey] ?? baseWindow,
    [baseWindow, windowByFold],
  );
  const toggleSegment = useCallback((segmentId: string, currentlyOpen: boolean) => {
    setOpenOverrides((current) => ({ ...current, [segmentId]: !currentlyOpen }));
  }, []);
  const showEarlier = useCallback(
    (foldKey: string) => {
      setWindowByFold((current) => ({
        ...current,
        [foldKey]: (current[foldKey] ?? baseWindow) + baseWindow,
      }));
    },
    [baseWindow],
  );
  return { openOverrides, pressureLevel, windowSizeFor, toggleSegment, showEarlier };
}
