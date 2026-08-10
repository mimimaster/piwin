import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import type { ArtifactActionMessage, ArtifactPreviewDecision } from '@piwin/artifact';
import {
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_FINAL_TRIM_SETTLE_MS,
  ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS,
  ARTIFACT_READY_TIMEOUT_MS,
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_LIVE_PRIORITY_NEAR,
  ARTIFACT_LIVE_PRIORITY_OFFSCREEN,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
  ARTIFACT_VIEWPORT_RECYCLE_TTL_MS,
  ARTIFACT_VIEWPORT_ROOT_MARGIN,
  INITIAL_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  cancelArtifactInit,
  claimArtifactLiveHost,
  clampArtifactHeight,
  isArtifactBridgeReadyMessage,
  isRectNearRoot,
  parseArtifactActionMessage,
  parseArtifactBridgeMessage,
  parseRootMarginYPx,
  releaseArtifactInit,
  releaseArtifactLiveHost,
  requestArtifactInit,
  resolveArtifactViewportHostIntent,
  resolveImmediateArtifactHeight,
  resolveInteractiveArtifactShrink,
  touchArtifactLiveHost,
  type ArtifactHeightPhase,
} from '@piwin/artifact';
import { useArtifactHeightSignal } from './artifact-height-signal';
import { useTranscriptScrollPort } from './transcript-scroll-port';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { IconSpark } from './shell-icons';

const ARTIFACT_ACTIVITY_ANIMATION = getBehaviorActivitySpec('artifact').animation;

/**
 * Aligned with openwebui_m ArtifactBlock streaming cadence:
 * first snapshot immediate, then at most one body update per window.
 */
const ARTIFACT_STREAM_RENDER_THROTTLE_MS = 300;
/** Coalesce height bridge posts (owi: rAF + 120ms). */
const ARTIFACT_BRIDGE_RESIZE_THROTTLE_MS = 120;
/** Ignore sub-pixel / 1–2px height noise that reads as layout flicker. */
const ARTIFACT_BRIDGE_HEIGHT_EPSILON_PX = 2;

export type ArtifactFrameProps = {
  decision: Extract<
    ArtifactPreviewDecision,
    { kind: 'render' } | { kind: 'blocked' } | { kind: 'preparing' }
  >;
  /** Higher = sooner init when many artifacts mount (history). */
  initPriority?: number;
  /** Presentation surface: inline (chat) or canvas (side panel). */
  presentation?: 'inline' | 'canvas';
  /**
   * Validated whitelisted action from the sandboxed artifact (e.g. flashcard
   * rating). Absent = actions are ignored (render-only artifact).
   */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  /**
   * Canvas-only: called when the artifact sends a `composer/propose-text`
   * action (e.g. "Use React" button in a canvas artifact). Ignored in inline
   * presentation.
   */
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  /**
   * Optional control in the frame's grid action rail (not over the iframe).
   * Product UI prefers a sibling `.artifact-side-rail` outside the frame;
   * keep this for tests and any remaining in-frame action hosts.
   */
  extraHeaderAction?: ReactElement;
  /** Localized preparing copy for chat and settings surfaces. */
  locale?: 'zh-CN' | 'en';
};

/** User-facing content label for an artifact descriptor type. */
function getArtifactContentLabel(type: 'html' | 'svg'): string {
  return type === 'svg' ? 'SVG' : 'HTML UI';
}

function getArtifactPreparingCopy(
  type: 'html' | 'svg',
  locale: 'zh-CN' | 'en',
): { title: string; detail: string } {
  const isSvg = type === 'svg';
  if (locale === 'zh-CN') {
    return {
      title: isSvg ? '正在生成 SVG' : '正在生成界面',
      detail: '首个可安全渲染的内容准备好后会自动显示',
    };
  }
  return {
    title: isSvg ? 'Generating SVG' : 'Rendering interface',
    detail: 'The first safe preview will appear automatically',
  };
}

function postArtifactStreamUpdate(
  iframe: HTMLIFrameElement | null,
  channelId: string,
  source: string | undefined,
  final = false,
): void {
  if (!iframe?.contentWindow || source === undefined) {
    return;
  }
  const message = {
    type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
    channelId,
    source,
    ...(final ? { final: true as const } : {}),
  };
  iframe.contentWindow.postMessage(message, '*');
}

/**
 * Desktop adapter for HTML artifacts.
 * - Uses sandboxed iframe + srcdoc from @piwin/artifact
 * - Height bridge: postMessage ready/resize with channelId
 * - Init queue: serialize srcdoc assignment for history
 * - Never executes model HTML in the parent document
 */
export function ArtifactFrame({
  decision,
  initPriority = 0,
  presentation = 'inline',
  onArtifactAction,
  onComposerProposal,
  extraHeaderAction,
  locale = 'en',
}: ArtifactFrameProps): ReactElement {
  const contentLabel = getArtifactContentLabel(decision.descriptor.type);
  if (decision.kind === 'blocked') {
    return (
      <div
        data-testid="artifact-frame"
        data-activity-id="artifact"
        data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
        data-tool-status="error"
        className={`artifact-frame blocked${presentation === 'canvas' ? ' presentation-canvas' : ''}`}
      >
        {extraHeaderAction ? (
          <div className="artifact-frame-actions">{extraHeaderAction}</div>
        ) : null}
        <p className="muted">
          Cannot preview this {contentLabel}: <code>{decision.reason}</code>
          {decision.security.externalResources.length > 0
            ? ` (${decision.security.externalResources.length} external resource(s))`
            : ''}
        </p>
      </div>
    );
  }

  if (decision.kind === 'preparing') {
    const preparingCopy = getArtifactPreparingCopy(decision.descriptor.type, locale);
    return (
      <div
        data-testid="artifact-frame"
        data-activity-id="artifact"
        data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
        data-tool-status="running"
        className={`artifact-frame preparing${presentation === 'canvas' ? ' presentation-canvas' : ''}`}
        role="status"
        aria-live="polite"
      >
        {extraHeaderAction ? (
          <div className="artifact-frame-actions">{extraHeaderAction}</div>
        ) : null}
        <div className="artifact-preparing-content">
          <span className="artifact-preparing-icon" aria-hidden="true">
            <IconSpark />
          </span>
          <span className="artifact-preparing-copy">
            <strong>{preparingCopy.title}</strong>
            <span>{preparingCopy.detail}</span>
          </span>
          <span className="artifact-preparing-sheen" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <ArtifactRenderFrame
      // One id owns the stream and completed lifecycle; mode is state, not identity.
      key={decision.descriptor.id}
      decision={decision}
      initPriority={initPriority}
      presentation={presentation}
      locale={locale}
      {...(onArtifactAction ? { onArtifactAction } : {})}
      {...(onComposerProposal ? { onComposerProposal } : {})}
      {...(extraHeaderAction ? { extraHeaderAction } : {})}
    />
  );
}

function ArtifactRenderFrame(props: {
  decision: Extract<ArtifactPreviewDecision, { kind: 'render' }>;
  initPriority: number;
  presentation: 'inline' | 'canvas';
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  extraHeaderAction?: ReactElement;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const {
    decision,
    initPriority,
    presentation,
    onArtifactAction,
    onComposerProposal,
    extraHeaderAction,
    locale,
  } = props;
  // Stable for the whole Artifact lifecycle. Stream completion must not
  // re-run the init queue or replace the iframe browsing context.
  const channelId = decision.descriptor.id;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const streamLifecycleRef = useRef(decision.mode === 'stream-preview');
  if (decision.mode === 'stream-preview') {
    streamLifecycleRef.current = true;
  }
  const usesStreamLifecycle = streamLifecycleRef.current;
  const latestRenderSourceRef = useRef(decision.renderSource);
  const latestUpdateIsFinalRef = useRef(decision.mode !== 'stream-preview');
  const latestDescriptorSourceRef = useRef(decision.descriptor.source);
  latestDescriptorSourceRef.current = decision.descriptor.source;
  const lastFinalSourceRef = useRef<string | null>(null);
  const [granted, setGranted] = useState(false);
  /**
   * Inline only: host the sandboxed iframe while in (or near) the transcript
   * viewport. After leaving for ARTIFACT_VIEWPORT_RECYCLE_TTL_MS, drop the
   * iframe to free WebContent memory; a height placeholder keeps layout stable.
   * Canvas and active stream-preview always host.
   */
  const [hostIframe, setHostIframe] = useState(true);
  const [height, setHeight] = useState(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const [contentOverflowing, setContentOverflowing] = useState(false);
  const [phase, setPhase] = useState<ArtifactHeightPhase>('protected');
  const [statusLabel, setStatusLabel] = useState<'loading' | 'ready' | 'timeout' | 'streaming'>(
    decision.mode === 'stream-preview' ? 'streaming' : 'loading',
  );
  const [paintedDocumentKey, setPaintedDocumentKey] = useState<string | null>(null);
  const frameRootRef = useRef<HTMLDivElement | null>(null);
  const leftViewportAtRef = useRef<number | null>(null);
  const isIntersectingRef = useRef<boolean | null>(null);
  const recycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostIframeRef = useRef(true);
  const floorRef = useRef(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const heightRef = useRef(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const phaseRef = useRef<ArtifactHeightPhase>('protected');
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shrinkPendingRef = useRef<number | null>(null);
  const slotReleasedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStreamPostAtRef = useRef(0);
  const streamPostedOnceRef = useRef(false);
  const pendingStreamSourceRef = useRef<string | undefined>(undefined);
  const streamThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBridgeHeightRef = useRef<number | null>(null);
  const bridgeResizeRafRef = useRef<number | null>(null);
  const bridgeResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxHeight = MAX_ARTIFACT_INLINE_FLOW_HEIGHT;
  const heightSignal = useArtifactHeightSignal();
  const transcriptScrollPort = useTranscriptScrollPort();
  // A frame first mounted for streaming keeps its bootstrap srcdoc through the
  // final commit; repaired body content and scripts are committed in place.
  // A directly-mounted completed/history frame still loads its final srcdoc.
  // evaluateCodeFence builds a NEW srcdoc string every render — reassigning
  // iframe.srcdoc reloads the document (white flash) even if content matches.
  const documentKey = usesStreamLifecycle
    ? `stream-lifecycle:${decision.descriptor.id}`
    : `${decision.mode}:${decision.descriptor.id}:${decision.srcdoc}`;
  const frozenSrcdocRef = useRef({ key: documentKey, srcdoc: decision.srcdoc });
  if (frozenSrcdocRef.current.key !== documentKey) {
    frozenSrcdocRef.current = { key: documentKey, srcdoc: decision.srcdoc };
  }
  const iframeSrcdoc = frozenSrcdocRef.current.srcdoc;

  /**
   * Enter final-trim: allow measured heights to shrink back to the real content
   * height for a short settle window, then lock to interactive (grow-only).
   * This recovers a tall artifact after a spiked measurement.
   */
  const startFinalTrim = (): void => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
    }
    phaseRef.current = 'final-trim';
    setPhase('final-trim');
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      phaseRef.current = 'interactive';
      setPhase('interactive');
    }, ARTIFACT_FINAL_TRIM_SETTLE_MS);
  };

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  // After the iframe layout height commits, re-stick the transcript tail.
  // App-level activitySignal is coalesced (~280ms) to avoid shell repaint
  // thrash; this path sticks immediately without re-rendering App.
  useLayoutEffect(() => {
    transcriptScrollPort?.notifyContentGrew();
  }, [height, transcriptScrollPort]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Stream body updates: first snapshot immediate, then ≤1 per 300ms. The final
  // repaired body bypasses the throttle and commits inside the same iframe.
  useEffect(() => {
    latestRenderSourceRef.current = decision.renderSource;
    latestUpdateIsFinalRef.current = decision.mode !== 'stream-preview';
    if (!granted || !usesStreamLifecycle) {
      return;
    }

    const source = decision.renderSource;
    const final = decision.mode !== 'stream-preview';
    const postNow = (nextSource: string, isFinal = false): void => {
      postArtifactStreamUpdate(iframeRef.current, channelId, nextSource, isFinal);
      lastStreamPostAtRef.current = Date.now();
      streamPostedOnceRef.current = true;
    };

    if (final) {
      if (lastFinalSourceRef.current === source) {
        return;
      }
      if (streamThrottleTimerRef.current) {
        clearTimeout(streamThrottleTimerRef.current);
        streamThrottleTimerRef.current = null;
      }
      pendingStreamSourceRef.current = undefined;
      lastFinalSourceRef.current = source;
      postNow(source, true);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastStreamPostAtRef.current;
    if (!streamPostedOnceRef.current || elapsed >= ARTIFACT_STREAM_RENDER_THROTTLE_MS) {
      if (streamThrottleTimerRef.current) {
        clearTimeout(streamThrottleTimerRef.current);
        streamThrottleTimerRef.current = null;
      }
      pendingStreamSourceRef.current = undefined;
      postNow(source);
      return;
    }

    pendingStreamSourceRef.current = source;
    if (streamThrottleTimerRef.current) {
      return;
    }
    streamThrottleTimerRef.current = setTimeout(() => {
      streamThrottleTimerRef.current = null;
      const pending = pendingStreamSourceRef.current;
      pendingStreamSourceRef.current = undefined;
      if (pending !== undefined) {
        postNow(pending);
      }
    }, ARTIFACT_STREAM_RENDER_THROTTLE_MS - elapsed);
  }, [channelId, decision.mode, decision.renderSource, granted, usesStreamLifecycle]);

  // Viewport lifecycle (inline only) + hard live-host budget:
  // - Near viewport → try to host immediately (loading shell, not blank).
  // - Off-screen for TTL → recycle (geometry re-check first).
  // - At most MAX_LIVE_ARTIFACT_IFRAMES concurrent sandboxed documents;
  //   claiming a slot may evict a lower-priority host (registry).
  // - Canvas / stream-preview are forceKeep and never budget-evicted.
  const forceHostIframe = presentation === 'canvas' || decision.mode === 'stream-preview';

  const tryHostIframe = (priority: number, forceKeep: boolean): void => {
    const claim = claimArtifactLiveHost({
      id: channelId,
      forceKeep,
      priority,
      evict: () => {
        hostIframeRef.current = false;
        setHostIframe(false);
      },
    });
    if (claim.admitted) {
      hostIframeRef.current = true;
      setHostIframe(true);
      return;
    }
    // Budget full of forceKeep hosts — stay recycled with loading intent only
    // when the user scrolls forceKeep frames away.
    hostIframeRef.current = false;
    setHostIframe(false);
  };

  const dropHostIframe = (): void => {
    releaseArtifactLiveHost(channelId);
    hostIframeRef.current = false;
    setHostIframe(false);
  };

  useEffect(() => {
    if (forceHostIframe) {
      leftViewportAtRef.current = null;
      isIntersectingRef.current = true;
      if (recycleTimerRef.current) {
        clearTimeout(recycleTimerRef.current);
        recycleTimerRef.current = null;
      }
      tryHostIframe(
        presentation === 'canvas' ? ARTIFACT_LIVE_PRIORITY_CANVAS : ARTIFACT_LIVE_PRIORITY_STREAM,
        true,
      );
      return () => {
        releaseArtifactLiveHost(channelId);
      };
    }

    const element = frameRootRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      isIntersectingRef.current = null;
      // Fail-open under budget: still claim so we never unbounded-mount.
      tryHostIframe(ARTIFACT_LIVE_PRIORITY_NEAR, false);
      return () => {
        releaseArtifactLiveHost(channelId);
      };
    }

    const marginY = parseRootMarginYPx(ARTIFACT_VIEWPORT_ROOT_MARGIN);
    const rootEl = transcriptScrollPort?.scrollElementRef.current ?? null;

    const isNearViewportNow = (): boolean => {
      const target = element.getBoundingClientRect();
      const rootRect = rootEl
        ? rootEl.getBoundingClientRect()
        : {
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            left: 0,
          };
      return isRectNearRoot(target, rootRect, marginY);
    };

    const applyVisibility = (visible: boolean): void => {
      isIntersectingRef.current = visible;
      if (visible) {
        leftViewportAtRef.current = null;
        if (recycleTimerRef.current) {
          clearTimeout(recycleTimerRef.current);
          recycleTimerRef.current = null;
        }
        tryHostIframe(ARTIFACT_LIVE_PRIORITY_VISIBLE, false);
        touchArtifactLiveHost(channelId, { priority: ARTIFACT_LIVE_PRIORITY_VISIBLE });
        return;
      }
      touchArtifactLiveHost(channelId, { priority: ARTIFACT_LIVE_PRIORITY_OFFSCREEN });
      if (leftViewportAtRef.current === null) {
        leftViewportAtRef.current = Date.now();
      }
      if (recycleTimerRef.current) {
        clearTimeout(recycleTimerRef.current);
      }
      const leftAt = leftViewportAtRef.current;
      const elapsed = Date.now() - leftAt;
      const remaining = Math.max(0, ARTIFACT_VIEWPORT_RECYCLE_TTL_MS - elapsed);
      recycleTimerRef.current = setTimeout(() => {
        recycleTimerRef.current = null;
        if (isIntersectingRef.current === true || isNearViewportNow()) {
          leftViewportAtRef.current = null;
          isIntersectingRef.current = true;
          tryHostIframe(ARTIFACT_LIVE_PRIORITY_VISIBLE, false);
          return;
        }
        const msSinceLeft = leftViewportAtRef.current
          ? Date.now() - leftViewportAtRef.current
          : ARTIFACT_VIEWPORT_RECYCLE_TTL_MS;
        const intent = resolveArtifactViewportHostIntent({
          presentation: 'inline',
          renderMode: decision.mode,
          isIntersecting: false,
          msSinceLeftViewport: msSinceLeft,
          recycleTtlMs: ARTIFACT_VIEWPORT_RECYCLE_TTL_MS,
        });
        if (intent === 'recycle') {
          dropHostIframe();
        } else {
          touchArtifactLiveHost(channelId, { priority: ARTIFACT_LIVE_PRIORITY_OFFSCREEN });
        }
      }, remaining);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const visible = entry.isIntersecting || isNearViewportNow();
        applyVisibility(visible);
      },
      {
        ...(rootEl ? { root: rootEl } : {}),
        rootMargin: ARTIFACT_VIEWPORT_ROOT_MARGIN,
        threshold: 0,
      },
    );
    observer.observe(element);
    applyVisibility(isNearViewportNow());

    return () => {
      observer.disconnect();
      if (recycleTimerRef.current) {
        clearTimeout(recycleTimerRef.current);
        recycleTimerRef.current = null;
      }
      releaseArtifactLiveHost(channelId);
    };
  }, [channelId, decision.mode, forceHostIframe, presentation, transcriptScrollPort]);

  // Init queue: grant before assigning srcdoc. Also re-runs when viewport
  // recycle remounts the iframe (hostIframe true again). Stream keeps a stable
  // channelId so completion does not thrash the browsing context by itself.
  const initPriorityRef = useRef(initPriority);
  initPriorityRef.current = initPriority;
  useEffect(() => {
    if (!hostIframe) {
      setGranted(false);
      setPaintedDocumentKey(null);
      cancelArtifactInit(channelId);
      releaseArtifactInit(channelId);
      return;
    }

    let cancelled = false;
    setGranted(false);
    setPaintedDocumentKey(null);
    slotReleasedRef.current = false;
    streamPostedOnceRef.current = false;
    lastStreamPostAtRef.current = 0;
    void requestArtifactInit(channelId, { priority: initPriorityRef.current }).then(() => {
      if (!cancelled) {
        setGranted(true);
      }
    });
    return () => {
      cancelled = true;
      // If still queued (never granted), drop it so a released slot is not
      // burned on this unmounted component ("Show code" toggle while waiting).
      cancelArtifactInit(channelId);
      releaseArtifactInit(channelId);
      if (shrinkTimerRef.current) {
        clearTimeout(shrinkTimerRef.current);
        shrinkTimerRef.current = null;
      }
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      if (streamThrottleTimerRef.current) {
        clearTimeout(streamThrottleTimerRef.current);
        streamThrottleTimerRef.current = null;
      }
      if (bridgeResizeRafRef.current !== null) {
        window.cancelAnimationFrame(bridgeResizeRafRef.current);
        bridgeResizeRafRef.current = null;
      }
      if (bridgeResizeTimerRef.current) {
        clearTimeout(bridgeResizeTimerRef.current);
        bridgeResizeTimerRef.current = null;
      }
    };
  }, [channelId, hostIframe]);

  // Height bridge listener
  useEffect(() => {
    if (!granted) {
      return;
    }

    let readyTimeout: number | null = null;

    const applyHeight = (nextHeight: number): void => {
      setContentOverflowing(nextHeight > maxHeight);
      const clamped = clampArtifactHeight(
        nextHeight,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        maxHeight,
        INITIAL_ARTIFACT_IFRAME_HEIGHT,
      );
      if (Math.abs(clamped - heightRef.current) < ARTIFACT_BRIDGE_HEIGHT_EPSILON_PX) {
        return;
      }
      floorRef.current = Math.max(floorRef.current, clamped);
      setHeight(clamped);
      // Notify scroll follow-tail (coalesced in App). Pass measured height so
      // sub-threshold noise does not re-render the whole shell.
      heightSignal?.notifyHeightChange(clamped);
    };

    const scheduleHeight = (nextHeight: number): void => {
      pendingBridgeHeightRef.current = nextHeight;
      if (bridgeResizeRafRef.current !== null || bridgeResizeTimerRef.current) {
        return;
      }
      bridgeResizeRafRef.current = window.requestAnimationFrame(() => {
        bridgeResizeRafRef.current = null;
        bridgeResizeTimerRef.current = setTimeout(() => {
          bridgeResizeTimerRef.current = null;
          const pending = pendingBridgeHeightRef.current;
          pendingBridgeHeightRef.current = null;
          if (pending !== null) {
            applyHeight(pending);
          }
        }, ARTIFACT_BRIDGE_RESIZE_THROTTLE_MS);
      });
    };

    const onMessage = (event: MessageEvent): void => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (iframeWindow && event.source && event.source !== iframeWindow) {
        return;
      }

      // Whitelisted user-intent actions (flashcard rating etc). Checks:
      // event.source, channelId, AND the cardId must be declared in the
      // artifact's own source (data-card-id) — a malicious artifact cannot
      // rate arbitrary cards, only the card it visibly renders.
      const actionMessage = parseArtifactActionMessage(event.data);
      if (actionMessage) {
        if (
          actionMessage.channelId === channelId &&
          onArtifactAction &&
          (actionMessage.action === 'flashcard/rate' ||
            actionMessage.action === 'flashcard/open-source') &&
          latestDescriptorSourceRef.current.includes(
            `data-card-id="${actionMessage.payload.cardId}"`,
          )
        ) {
          onArtifactAction(actionMessage);
        }
        // Canvas-only: composer/propose-text action from artifact content.
        if (
          presentation === 'canvas' &&
          onComposerProposal &&
          actionMessage.action === 'composer/propose-text' &&
          actionMessage.channelId === channelId
        ) {
          onComposerProposal(actionMessage.payload);
        }
        return;
      }

      // Canvas-only fallback: composer/propose-text may arrive as a raw
      // message that parseArtifactActionMessage already handles above.
      // This block catches any future action types that are not yet parsed.

      const message = parseArtifactBridgeMessage(event.data);
      if (!message || message.channelId !== channelId) {
        return;
      }

      const immediate = resolveImmediateArtifactHeight({
        height: message.height,
        currentHeight: heightRef.current,
        floor: floorRef.current,
        phase: phaseRef.current,
        mode: message.mode,
        minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
        initialHeight: INITIAL_ARTIFACT_IFRAME_HEIGHT,
      });

      const shrink = resolveInteractiveArtifactShrink({
        phase: phaseRef.current,
        mode: message.mode,
        nextHeight: immediate,
        currentHeight: heightRef.current,
        timerActive: shrinkTimerRef.current !== null,
      });

      if (shrink.defer) {
        shrinkPendingRef.current = shrink.pendingHeight;
        if (shrink.startTimer) {
          shrinkTimerRef.current = setTimeout(() => {
            shrinkTimerRef.current = null;
            const pending = shrinkPendingRef.current;
            shrinkPendingRef.current = null;
            if (pending !== null) {
              applyHeight(pending);
            }
          }, ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS);
        }
        return;
      }

      // First ready height applies immediately so the frame appears promptly;
      // later resizes are coalesced (owi-style) to avoid layout thrash.
      if (isArtifactBridgeReadyMessage(message) && phaseRef.current === 'protected') {
        if (readyTimeout !== null) {
          window.clearTimeout(readyTimeout);
          readyTimeout = null;
        }
        applyHeight(immediate);
        setStatusLabel(decision.mode === 'stream-preview' ? 'streaming' : 'ready');
        setPaintedDocumentKey(documentKey);
        // Stream-preview must stay grow-only (`protected`). Opening final-trim
        // while tokens still arrive lets measured height shrink between
        // snapshots — very visible flicker for SVG canvases and HTML cards.
        if (decision.mode !== 'stream-preview') {
          startFinalTrim();
        }
        if (!slotReleasedRef.current) {
          slotReleasedRef.current = true;
          releaseArtifactInit(channelId);
        }
        return;
      }

      scheduleHeight(immediate);
    };

    window.addEventListener('message', onMessage);

    readyTimeout = window.setTimeout(() => {
      if (phaseRef.current === 'protected') {
        setStatusLabel('timeout');
        setPaintedDocumentKey(documentKey);
        // Never open final-trim while still in stream-preview.
        if (decision.mode !== 'stream-preview') {
          startFinalTrim();
        }
        if (!slotReleasedRef.current) {
          slotReleasedRef.current = true;
          releaseArtifactInit(channelId);
        }
      }
    }, ARTIFACT_READY_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', onMessage);
      if (readyTimeout !== null) {
        window.clearTimeout(readyTimeout);
      }
      if (bridgeResizeRafRef.current !== null) {
        window.cancelAnimationFrame(bridgeResizeRafRef.current);
        bridgeResizeRafRef.current = null;
      }
      if (bridgeResizeTimerRef.current) {
        clearTimeout(bridgeResizeTimerRef.current);
        bridgeResizeTimerRef.current = null;
      }
    };
  }, [
    granted,
    channelId,
    decision.mode,
    maxHeight,
    onArtifactAction,
    onComposerProposal,
    presentation,
    heightSignal,
    documentKey,
  ]);

  // Reset height only when the iframe *document identity* changes (not every
  // parent re-render with a freshly-built but equivalent srcdoc string).
  useEffect(() => {
    if (usesStreamLifecycle && decision.mode === 'stream-preview') {
      floorRef.current = Math.max(floorRef.current, INITIAL_ARTIFACT_IFRAME_HEIGHT);
      setContentOverflowing(false);
      phaseRef.current = 'protected';
      setPhase('protected');
      setStatusLabel('streaming');
      slotReleasedRef.current = false;
      streamPostedOnceRef.current = false;
      lastStreamPostAtRef.current = 0;
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }
    if (usesStreamLifecycle) {
      // Preserve the visible frame and its measured height while the final body
      // is committed. The final ready/trim messages may then shrink cleanly.
      setContentOverflowing(false);
      phaseRef.current = 'protected';
      setPhase('protected');
      setStatusLabel('loading');
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }
    setHeight(INITIAL_ARTIFACT_IFRAME_HEIGHT);
    setContentOverflowing(false);
    floorRef.current = INITIAL_ARTIFACT_IFRAME_HEIGHT;
    phaseRef.current = 'protected';
    setPhase('protected');
    setStatusLabel('loading');
    slotReleasedRef.current = false;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setPaintedDocumentKey(null);
  }, [decision.mode, documentKey, usesStreamLifecycle]);

  const isCanvas = presentation === 'canvas';
  const hasExtraHeaderAction = extraHeaderAction !== undefined;
  const isPainted = paintedDocumentKey === documentKey;
  // Never leave a parked viewport on a pure blank: show sheen until the
  // bridge marks ready (or timeout paints). Recycled off-screen uses a shell.
  const showLoadingShell = hostIframe && !isPainted;
  return (
    <div
      ref={frameRootRef}
      data-testid="artifact-frame"
      data-activity-id="artifact"
      data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
      data-tool-status={statusLabel === 'ready' ? 'done' : 'running'}
      data-artifact-host={hostIframe ? (isPainted ? 'live' : 'loading') : 'recycled'}
      data-content-overflowing={contentOverflowing ? 'true' : undefined}
      className={`artifact-frame${isCanvas ? ' presentation-canvas' : ''}${hasExtraHeaderAction ? ' has-artifact-action' : ''}${hostIframe ? '' : ' is-recycled'}${showLoadingShell ? ' is-loading' : ''}`}
    >
      {extraHeaderAction ? <div className="artifact-frame-actions">{extraHeaderAction}</div> : null}
      {!hostIframe ? (
        <div
          className="artifact-iframe-placeholder artifact-iframe-placeholder--recycled"
          data-testid="artifact-iframe-placeholder"
          style={{
            minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
            height,
            maxHeight,
            width: '100%',
          }}
          aria-hidden
        >
          <span className="artifact-preparing-sheen" aria-hidden="true" />
        </div>
      ) : (
        <div
          className="artifact-iframe-stage"
          style={
            isCanvas
              ? { minHeight: '100%', height: '100%', maxHeight: '100%', width: '100%' }
              : {
                  position: 'relative',
                  minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
                  height,
                  maxHeight,
                  width: '100%',
                }
          }
        >
          {showLoadingShell ? (
            <div
              className="artifact-iframe-loading"
              data-testid="artifact-iframe-loading"
              role="status"
              aria-live="polite"
            >
              <span className="artifact-preparing-icon" aria-hidden="true">
                <IconSpark />
              </span>
              <span className="artifact-iframe-loading-copy">
                {locale === 'zh-CN' ? '正在加载预览…' : 'Loading preview…'}
              </span>
              <span className="artifact-preparing-sheen" aria-hidden="true" />
            </div>
          ) : null}
          {granted ? (
            <iframe
              ref={iframeRef as RefObject<HTMLIFrameElement>}
              className={`artifact-iframe${isPainted ? ' is-painted' : ' is-pending-paint'}`}
              title={decision.descriptor.title}
              srcDoc={iframeSrcdoc}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              onLoad={() => {
                if (usesStreamLifecycle) {
                  // Force first paint snapshot on load (bypass throttle window).
                  streamPostedOnceRef.current = false;
                  lastStreamPostAtRef.current = 0;
                  postArtifactStreamUpdate(
                    iframeRef.current,
                    channelId,
                    latestRenderSourceRef.current,
                    latestUpdateIsFinalRef.current,
                  );
                  streamPostedOnceRef.current = true;
                  lastStreamPostAtRef.current = Date.now();
                } else {
                  // Interactive remounts: reveal as soon as the document loads so
                  // a parked viewport never sits on a hidden iframe waiting for
                  // the bridge postMessage (ready still refines height).
                  setPaintedDocumentKey(documentKey);
                  setStatusLabel((prev) => (prev === 'ready' ? prev : 'loading'));
                }
              }}
              style={
                isCanvas
                  ? {
                      minHeight: '100%',
                      height: '100%',
                      maxHeight: '100%',
                      width: '100%',
                      border: 0,
                      opacity: isPainted ? 1 : 0,
                    }
                  : {
                      minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
                      height: '100%',
                      maxHeight: '100%',
                      width: '100%',
                      border: 0,
                      opacity: isPainted ? 1 : 0,
                    }
              }
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
