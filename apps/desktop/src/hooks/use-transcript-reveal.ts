import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

const STABLE_LAYOUT_MS = 180;
/**
 * Every mounted turn was laid out at a remembered real height and its mount
 * agreed: there is no estimate left to correct, so a few quiet frames are
 * enough. Late reflows (images, artifacts) still hold the cover below.
 */
const STABLE_CACHED_LAYOUT_MS = 50;
const MAX_PREPARATION_MS = 1_600;

type TranscriptRevealOptions = {
  sessionId?: string | undefined;
  messageCount: number;
  awaitingTranscript: boolean;
  historyViewActive: boolean;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  jumpToLatest: () => void;
  /**
   * Put the viewport where this open should land and report whether it is
   * there. Defaults to the live tail; a remembered reading position passes
   * its own target so the cover lifts on that message instead.
   */
  settlePosition?: () => boolean;
};

function isAtBottom(element: HTMLElement): boolean {
  const maximumTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return maximumTop - Math.max(0, Math.min(element.scrollTop, maximumTop)) <= 2;
}

/** Keep first-open layout corrections behind a loading state, without unmounting content. */
export function useTranscriptReveal(options: TranscriptRevealOptions): boolean {
  const sessionId = options.sessionId ?? null;
  const hasMessages = options.messageCount > 0;
  const [revealedSessionId, setRevealedSessionId] = useState<string | null>(() =>
    options.historyViewActive ||
    (options.awaitingTranscript && hasMessages) ||
    (!options.awaitingTranscript && !hasMessages) ? sessionId : null,
  );
  const settlePositionRef = useRef(options.settlePosition);
  settlePositionRef.current = options.settlePosition;
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
    const settle = (): boolean => {
      const settlePosition = settlePositionRef.current;
      if (settlePosition) return settlePosition();
      options.jumpToLatest();
      return isAtBottom(element);
    };
    const reveal = (): void => {
      if (cancelled) return;
      cancelled = true;
      settle();
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
      // re-settle even if a virtualizer correction was mistaken for scroll-away.
      const positioned = settle();
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
      const slots = windowElement ? Array.from(windowElement.children) : [];
      const laidOutFromCache =
        slots.length > 0 &&
        slots.every(
          (slot) => slot instanceof HTMLElement && slot.dataset.heightCached === 'true',
        );
      const stableFor = laidOutFromCache ? STABLE_CACHED_LAYOUT_MS : STABLE_LAYOUT_MS;
      if (
        element.clientHeight > 0 &&
        measured &&
        !pendingImage &&
        !pendingFrame &&
        pendingMedia === null &&
        positioned &&
        now - stableSince >= stableFor
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
