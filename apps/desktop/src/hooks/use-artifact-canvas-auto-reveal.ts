/**
 * Applies Canvas auto-reveal to the live session transcript.
 * Does not focus the panel; `onReveal` must not steal keyboard focus.
 * `onUpdate` replaces source on the same target id without reopening the tab.
 */
import { useEffect, useRef } from 'react';
import type { ChatMessageUi, RunTerminalState } from '../chat-reducer';
import type { ArtifactCanvasTarget } from '../artifact-canvas-model';
import {
  advanceArtifactCanvasAutoReveal,
  createArtifactCanvasAutoRevealState,
} from '../artifact-canvas-auto-reveal';

export function useArtifactCanvasAutoReveal(input: {
  activeSessionId: string | null;
  messages: readonly ChatMessageUi[];
  enabled: boolean;
  maxBytes?: number;
  runTerminalKind?: RunTerminalState['kind'];
  onReveal: (target: ArtifactCanvasTarget) => void;
  onUpdate: (target: ArtifactCanvasTarget) => void;
}): void {
  const stateRef = useRef(createArtifactCanvasAutoRevealState());

  useEffect(() => {
    // This hook runs at workbench level, outside the transcript/Canvas render
    // boundaries. A throw here (including inside onReveal/onUpdate) would
    // unmount the root, so it is contained and logged instead.
    try {
      const result = advanceArtifactCanvasAutoReveal(stateRef.current, {
        sessionId: input.activeSessionId,
        messages: input.messages,
        enabled: input.enabled,
        ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
        ...(input.runTerminalKind !== undefined
          ? { runTerminalKind: input.runTerminalKind }
          : {}),
      });
      stateRef.current = result.state;
      if (!result.target || result.action === null) {
        return;
      }
      if (result.action === 'reveal') {
        input.onReveal(result.target);
        return;
      }
      input.onUpdate(result.target);
    } catch (error) {
      console.warn('[piwin] artifact canvas auto-reveal failed', error);
    }
  }, [
    input.activeSessionId,
    input.enabled,
    input.maxBytes,
    input.runTerminalKind,
    input.messages,
    input.onReveal,
    input.onUpdate,
  ]);
}
