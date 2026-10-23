import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ARTIFACT_BRIDGE_RETIRE_TYPE,
  ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE,
  parseArtifactScrollMessage,
} from '@piwin/artifact';
import type { ArtifactDocument } from './artifact-frame-stream.js';

/**
 * A successor that never loads or never answers must not leave the reader
 * looking at a dead document; the outgoing frame is dropped regardless.
 */
export const ARTIFACT_HANDOFF_LOAD_TIMEOUT_MS = 1_500;
export const ARTIFACT_HANDOFF_RESTORE_TIMEOUT_MS = 500;
/** Lets the successor paint its restored scroll offset before it is revealed. */
export const ARTIFACT_HANDOFF_REVEAL_DELAY_MS = 34;

export type ArtifactDocumentHandoff = {
  /** Replaced document, kept on screen until its successor is ready. */
  outgoing: ArtifactDocument | null;
  outgoingRef: RefObject<HTMLIFrameElement | null>;
  /** Call from the successor iframe's `load`. */
  onIncomingLoad: () => void;
};

type TrackedDocuments = {
  current: ArtifactDocument;
  outgoing: ArtifactDocument | null;
};

/**
 * Hands the Canvas from one document to the next without a blank frame.
 *
 * Writing a Canvas document replaces the iframe document more than once
 * (stream shell → seeded shell → final), and a late session-media binding
 * replaces it again. Navigating one iframe in place shows an empty frame until
 * the new document paints and drops the reader back to the top. Here the
 * replaced document stays on screen, retired, while its successor loads
 * underneath and resumes the same scroll offset; only then is it removed.
 */
export function useArtifactDocumentHandoff(input: {
  channelId: string;
  document: ArtifactDocument;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  enabled: boolean;
}): ArtifactDocumentHandoff {
  const { channelId, document, iframeRef, enabled } = input;
  const outgoingRef = useRef<HTMLIFrameElement | null>(null);
  const loadedDocumentIdRef = useRef<string | null>(null);
  const scrollTopRef = useRef(0);
  const awaitingRestoreRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tracked, setTracked] = useState<TrackedDocuments>({ current: document, outgoing: null });

  let outgoing = tracked.outgoing;
  if (tracked.current.documentId !== document.documentId) {
    // Only a document the reader has actually seen is worth keeping on screen.
    outgoing =
      enabled && loadedDocumentIdRef.current === tracked.current.documentId
        ? tracked.current
        : null;
    setTracked({ current: document, outgoing });
  } else if (!enabled && outgoing !== null) {
    outgoing = null;
    setTracked({ current: document, outgoing: null });
  }
  const outgoingDocumentId = outgoing?.documentId ?? null;

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const release = useCallback((): void => {
    clearTimer();
    awaitingRestoreRef.current = false;
    setTracked((state) => (state.outgoing === null ? state : { ...state, outgoing: null }));
  }, [clearTimer]);

  const releaseAfterPaint = useCallback((): void => {
    clearTimer();
    awaitingRestoreRef.current = false;
    timerRef.current = setTimeout(release, ARTIFACT_HANDOFF_REVEAL_DELAY_MS);
  }, [clearTimer, release]);

  useLayoutEffect(() => {
    if (outgoingDocumentId === null) {
      return;
    }
    outgoingRef.current?.contentWindow?.postMessage(
      { type: ARTIFACT_BRIDGE_RETIRE_TYPE, channelId },
      '*',
    );
    clearTimer();
    timerRef.current = setTimeout(release, ARTIFACT_HANDOFF_LOAD_TIMEOUT_MS);
    return clearTimer;
  }, [channelId, clearTimer, outgoingDocumentId, release]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.source === window) {
        return;
      }
      const message = parseArtifactScrollMessage(event.data);
      if (!message || message.channelId !== channelId) {
        return;
      }
      scrollTopRef.current = message.top;
      if (message.restored && awaitingRestoreRef.current) {
        releaseAfterPaint();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [channelId, enabled, releaseAfterPaint]);

  const onIncomingLoad = useCallback((): void => {
    loadedDocumentIdRef.current = document.documentId;
    if (outgoingDocumentId === null) {
      return;
    }
    const top = scrollTopRef.current;
    const target = iframeRef.current?.contentWindow;
    if (top <= 0 || !target) {
      releaseAfterPaint();
      return;
    }
    awaitingRestoreRef.current = true;
    target.postMessage({ type: ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE, channelId, top }, '*');
    clearTimer();
    timerRef.current = setTimeout(release, ARTIFACT_HANDOFF_RESTORE_TIMEOUT_MS);
  }, [channelId, clearTimer, document.documentId, iframeRef, outgoingDocumentId, release, releaseAfterPaint]);

  return { outgoing, outgoingRef, onIncomingLoad };
}
