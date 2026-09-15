import { useLayoutEffect, type RefObject } from 'react';

/** Restore width when React hands the style to/from the pointer frame owner. */
export function usePanelWidthCommit(
  committedWidth: number,
  isResizing: boolean,
  liveWidth: RefObject<number>,
  writeWidth: (width: number) => void,
): void {
  // Stream commits must not write the pending pointer width ahead of its rAF.
  // The shell omits this style prop throughout the drag, so only ownership
  // changes (and explicit width commits) need a post-React correction.
  useLayoutEffect(() => {
    writeWidth(liveWidth.current);
  }, [committedWidth, isResizing, liveWidth, writeWidth]);
}
