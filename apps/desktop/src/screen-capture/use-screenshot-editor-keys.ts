/**
 * Keyboard for the capture editor: tool letters, ⌘Z / ⇧⌘Z, Enter to finish,
 * Esc to leave, arrow keys to nudge the region. Handlers are read through a
 * ref so the window listener is installed once.
 */
import { useEffect, useRef } from 'react';
import type { AnnotationTool } from './annotation-model.js';
import { annotationToolForKey } from './annotation-toolbar.js';

export type ScreenshotEditorKeyHandlers = {
  onUndo: () => void;
  onRedo: () => void;
  onTool: (tool: AnnotationTool) => void;
  onFinish: () => void;
  onEscape: () => void;
  /** Arrow keys, in view pixels (Shift moves 10). */
  onNudge: (dx: number, dy: number) => void;
};

const NUDGES: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

export function useScreenshotEditorKeys(handlers: ScreenshotEditorKeyHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      // The inline text field handles its own Enter / Escape.
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      const current = latest.current;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) current.onRedo();
        else current.onUndo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const nudge = NUDGES[key];
      if (nudge !== undefined) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        current.onNudge(nudge[0] * step, nudge[1] * step);
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        current.onFinish();
        return;
      }
      if (key === 'escape') {
        event.preventDefault();
        current.onEscape();
        return;
      }
      const tool = annotationToolForKey(key);
      if (tool !== undefined) {
        event.preventDefault();
        current.onTool(tool);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, []);
}
