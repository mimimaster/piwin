import { useLayoutEffect, useState, type RefObject } from 'react';

const MIN_PREPARATION_MS = 300;
const STABLE_LAYOUT_MS = 180;
const MAX_PREPARATION_MS = 1_600;

type TranscriptRevealOptions = {
  sessionId?: string | undefined;
  messageCount: number;
  awaitingTranscript: boolean;
  historyViewActive: boolean;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  jumpToLatest: () => void;
};

/** Keep first-open layout corrections behind a loading state, without unmounting content. */
export function useTranscriptReveal(options: TranscriptRevealOptions): boolean {
  const sessionId = options.sessionId ?? null;
  const hasMessages = options.messageCount > 0;
  const [revealedSessionId, setRevealedSessionId] = useState<string | null>(() =>
    options.historyViewActive || (!options.awaitingTranscript && !hasMessages) ? sessionId : null,
  );
  const opening =
    sessionId !== null &&
    revealedSessionId !== sessionId &&
    !options.historyViewActive &&
    (options.awaitingTranscript || hasMessages);

  useLayoutEffect(() => {
    if (!opening) {
      setRevealedSessionId(sessionId);
      return;
    }
    // The layout deadline starts after the snapshot arrives, not while waiting
    // on the Host. A network wait must not expose an empty/stale transcript.
    if (options.awaitingTranscript || !hasMessages) return;
    const element = options.scrollElementRef.current;
    if (!element) return;

    let cancelled = false;
    let frame = 0;
    let previousGeometry = '';
    const startedAt = Date.now();
    let stableSince = startedAt;
    const reveal = (): void => {
      if (cancelled) return;
      cancelled = true;
      options.jumpToLatest();
      setRevealedSessionId(sessionId);
    };
    // A backgrounded WKWebView can starve rAF. Never leave a loaded transcript
    // permanently covered, including when a preview never finishes loading.
    const deadline = window.setTimeout(reveal, MAX_PREPARATION_MS);
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            stableSince = Date.now();
          });
    observer?.observe(element, { childList: true, subtree: true, characterData: true });

    const sample = (): void => {
      if (cancelled) return;
      // While covered there is no history gesture to preserve. Explicitly
      // re-pin even if a virtualizer correction was mistaken for scroll-away.
      options.jumpToLatest();
      const windowElement = element.querySelector('.transcript-turn-window');
      const tail = windowElement?.lastElementChild;
      const body = tail?.firstElementChild;
      const tailHeight = tail?.getBoundingClientRect().height ?? 0;
      const bodyHeight = body?.getBoundingClientRect().height ?? 0;
      const maximumTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const top = Math.max(0, Math.min(element.scrollTop, maximumTop));
      const geometry = [
        element.scrollHeight,
        element.clientHeight,
        element.clientWidth,
        top,
        tailHeight,
        bodyHeight,
      ].join(':');
      const now = Date.now();
      if (geometry !== previousGeometry) {
        previousGeometry = geometry;
        stableSince = now;
      }
      const measured =
        !windowElement ||
        (body !== null &&
          body !== undefined &&
          bodyHeight > 0 &&
          Math.abs(tailHeight - bodyHeight) <= 2);
      const pendingImage = Array.from(element.querySelectorAll('img')).some(
        (image) => !image.complete,
      );
      const pendingFrame = element.querySelector(
        '[data-artifact-height-status]:not([data-artifact-height-status="ready"]):not([data-artifact-height-status="fallback"])',
      );
      const pendingMedia = element.querySelector('[data-media-preview-loading="true"]');
      if (
        element.clientHeight > 0 &&
        measured &&
        !pendingImage &&
        !pendingFrame &&
        pendingMedia === null &&
        maximumTop - top <= 2 &&
        now - startedAt >= MIN_PREPARATION_MS &&
        now - stableSince >= STABLE_LAYOUT_MS
      ) {
        reveal();
        return;
      }
      frame = window.requestAnimationFrame(sample);
    };
    frame = window.requestAnimationFrame(sample);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(deadline);
      observer?.disconnect();
    };
  }, [
    opening,
    sessionId,
    hasMessages,
    options.awaitingTranscript,
    options.scrollElementRef,
    options.jumpToLatest,
  ]);

  return opening;
}
