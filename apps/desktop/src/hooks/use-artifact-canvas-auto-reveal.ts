/**
 * Applies Canvas auto-reveal to the live session transcript.
 * Does not focus the panel; `onReveal` must not steal keyboard focus.
 */
import { useEffect, useRef } from 'react';
import type { ChatMessageUi } from '../chat-reducer';
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
  onReveal: (target: ArtifactCanvasTarget) => void;
}): void {
  const stateRef = useRef(createArtifactCanvasAutoRevealState());

  useEffect(() => {
    const result = advanceArtifactCanvasAutoReveal(stateRef.current, {
      sessionId: input.activeSessionId,
      messages: input.messages,
      enabled: input.enabled,
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    });
    stateRef.current = result.state;
    if (result.target) {
      input.onReveal(result.target);
    }
  }, [input.activeSessionId, input.enabled, input.maxBytes, input.messages, input.onReveal]);
}
