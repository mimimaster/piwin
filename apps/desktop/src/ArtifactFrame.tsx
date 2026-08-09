import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { ArtifactActionMessage, ArtifactPreviewDecision } from '@piwin/artifact';
import {
  ARTIFACT_FINAL_TRIM_SETTLE_MS,
  ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS,
  ARTIFACT_READY_TIMEOUT_MS,
  INITIAL_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_IFRAME_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  cancelArtifactInit,
  clampArtifactHeight,
  isArtifactBridgeReadyMessage,
  parseArtifactActionMessage,
  parseArtifactBridgeMessage,
  releaseArtifactInit,
  requestArtifactInit,
  resolveImmediateArtifactHeight,
  resolveInteractiveArtifactShrink,
  type ArtifactHeightPhase,
} from '@piwin/artifact';
import { useArtifactHeightSignal } from './artifact-height-signal';
import { getBehaviorActivitySpec } from './behavior-activity.js';

const ARTIFACT_ACTIVITY_ANIMATION = getBehaviorActivitySpec('artifact').animation;

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
   * Optional extra control rendered at the end of the artifact header row.
   * Used by MarkdownView's in-place code/render toggle ("Show code") so the
   * affordance lives inside the rendered frame instead of stacking a second
   * code block above it. Source inspection goes through that toggle — render
   * mode no longer duplicates raw source under the iframe.
   */
  extraHeaderAction?: ReactElement;
};

/** User-facing content label for an artifact descriptor type. */
function getArtifactContentLabel(type: 'html' | 'svg'): string {
  return type === 'svg' ? 'SVG' : 'HTML UI';
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
}: ArtifactFrameProps): ReactElement {
  const contentLabel = getArtifactContentLabel(decision.descriptor.type);
  if (decision.kind === 'blocked') {
    return (
      <div data-testid="artifact-frame" data-activity-id="artifact" data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION} data-tool-status="error" className={`artifact-frame blocked${presentation === 'canvas' ? ' presentation-canvas' : ''}`}>
        <div className="artifact-frame-header">
          <strong>{decision.descriptor.title}</strong>
          <span className="pill">blocked</span>
          {extraHeaderAction ?? null}
        </div>
        <p className="muted">
          Cannot preview this {contentLabel}: <code>{decision.reason}</code>
          {decision.security.externalResources.length > 0
            ? ` (${decision.security.externalResources.length} external resource(s))`
            : ''}
        </p>
        <details>
          <summary>Source (raw model {contentLabel})</summary>
          <pre className="md-code">
            <code>{decision.descriptor.source}</code>
          </pre>
        </details>
      </div>
    );
  }

  if (decision.kind === 'preparing') {
    return (
      <div data-testid="artifact-frame" data-activity-id="artifact" data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION} data-tool-status="running" className={`artifact-frame preparing${presentation === 'canvas' ? ' presentation-canvas' : ''}`}>
        <div className="artifact-frame-header">
          <strong>{decision.descriptor.title}</strong>
          <span className="pill">streaming</span>
          {extraHeaderAction ?? null}
        </div>
        <p className="muted">{decision.message}</p>
        <details>
          <summary>Source (raw model {contentLabel}) so far</summary>
          <pre className="md-code">
            <code>{decision.descriptor.source}</code>
          </pre>
        </details>
      </div>
    );
  }

  return (
    <ArtifactRenderFrame
      decision={decision}
      initPriority={initPriority}
      presentation={presentation}
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
}): ReactElement {
  const { decision, initPriority, presentation, onArtifactAction, onComposerProposal, extraHeaderAction } = props;
  const channelId =
    decision.mode === 'stream-preview'
      ? `${decision.descriptor.id}-stream`
      : decision.descriptor.id;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [granted, setGranted] = useState(false);
  const [height, setHeight] = useState(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const [contentOverflowing, setContentOverflowing] = useState(false);
  const [phase, setPhase] = useState<ArtifactHeightPhase>('protected');
  const [statusLabel, setStatusLabel] = useState<'loading' | 'ready' | 'timeout' | 'streaming'>(
    decision.mode === 'stream-preview' ? 'streaming' : 'loading',
  );
  const floorRef = useRef(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const heightRef = useRef(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const phaseRef = useRef<ArtifactHeightPhase>('protected');
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shrinkPendingRef = useRef<number | null>(null);
  const slotReleasedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxHeight = MAX_ARTIFACT_IFRAME_HEIGHT;
  const heightSignal = useArtifactHeightSignal();

  /**
   * Enter final-trim: allow measured heights to shrink back to the real content
   * height for a short settle window, then lock to interactive (grow-only).
   * This recovers a tall artifact after a spiked measurement.
   */
  const startFinalTrim = (): void => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
    }
    setPhase('final-trim');
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setPhase('interactive');
    }, ARTIFACT_FINAL_TRIM_SETTLE_MS);
  };

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Init queue: grant before assigning srcdoc
  useEffect(() => {
    let cancelled = false;
    setGranted(false);
    void requestArtifactInit(channelId, { priority: initPriority }).then(() => {
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
    };
  }, [channelId, initPriority]);

  // Height bridge listener
  useEffect(() => {
    if (!granted) {
      return;
    }

    const applyHeight = (nextHeight: number): void => {
      setContentOverflowing(nextHeight > maxHeight);
      const clamped = clampArtifactHeight(
        nextHeight,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        maxHeight,
        INITIAL_ARTIFACT_IFRAME_HEIGHT,
      );
      floorRef.current = Math.max(floorRef.current, clamped);
      setHeight(clamped);
      // Notify the transcript scroll system that the iframe grew, so
      // follow-tail scrolling re-fires even without text length changes.
      heightSignal?.notifyHeightChange(clamped);
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
          (actionMessage.action === 'flashcard/rate' || actionMessage.action === 'flashcard/open-source') &&
          decision.descriptor.source.includes(`data-card-id="${actionMessage.payload.cardId}"`)
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

      applyHeight(immediate);

      if (isArtifactBridgeReadyMessage(message) && phaseRef.current === 'protected') {
        setStatusLabel(decision.mode === 'stream-preview' ? 'streaming' : 'ready');
        // Enter a short settle window: measured heights may shrink back to the
        // real content height, then lock grow-only. Also frees the init slot so
        // other artifacts in history can mount.
        startFinalTrim();
        if (!slotReleasedRef.current) {
          slotReleasedRef.current = true;
          releaseArtifactInit(channelId);
        }
      }
    };

    window.addEventListener('message', onMessage);

    const readyTimeout = window.setTimeout(() => {
      if (phaseRef.current === 'protected') {
        setStatusLabel('timeout');
        startFinalTrim();
        if (!slotReleasedRef.current) {
          slotReleasedRef.current = true;
          releaseArtifactInit(channelId);
        }
      }
    }, ARTIFACT_READY_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(readyTimeout);
    };
  }, [granted, channelId, decision.mode, decision.descriptor.source, maxHeight, onArtifactAction]);
  // Note: presentation and onComposerProposal are intentionally not in the
  // deps array above — the message listener is per-grant cycle and reads the
  // latest values from closure. Adding them would re-bind the listener on
  // every parent re-render without functional benefit.

  // Reset height state when srcdoc identity changes
  useEffect(() => {
    // During stream-preview, the srcdoc changes on every token as
    // MarkdownView re-evaluates the fence. Resetting height to 80px each
    // time causes a collapse-regrow cycle and loses the floor. Instead,
    // preserve the current height as the new floor so the iframe stays
    // at its measured height and only grows from there.
    if (decision.mode === 'stream-preview') {
      // Keep the current height as floor; don't collapse.
      floorRef.current = Math.max(floorRef.current, INITIAL_ARTIFACT_IFRAME_HEIGHT);
      setContentOverflowing(false);
      setPhase('protected');
      setStatusLabel('streaming');
      slotReleasedRef.current = false;
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }
    setHeight(INITIAL_ARTIFACT_IFRAME_HEIGHT);
    setContentOverflowing(false);
    floorRef.current = INITIAL_ARTIFACT_IFRAME_HEIGHT;
    setPhase('protected');
    // After the stream-preview early return above, decision.mode is
    // narrowed to 'interactive' — always use 'loading' here.
    setStatusLabel('loading');
    slotReleasedRef.current = false;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, [decision.srcdoc, decision.mode]);

  const modePill =
    decision.mode === 'stream-preview'
      ? 'stream'
      : statusLabel === 'ready'
        ? 'preview'
        : statusLabel;

  const isCanvas = presentation === 'canvas';
  return (
    <div
      data-testid="artifact-frame"
      data-activity-id="artifact"
      data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
      data-tool-status={statusLabel === 'ready' ? 'done' : 'running'}
      data-content-overflowing={contentOverflowing ? 'true' : undefined}
      className={`artifact-frame${isCanvas ? ' presentation-canvas' : ''}`}
    >
      <div className="artifact-frame-header">
        <strong>{decision.descriptor.title}</strong>
        <span
          className={
            statusLabel === 'ready' || decision.mode === 'stream-preview' ? 'pill ok' : 'pill'
          }
        >
          {modePill}
        </span>
        {contentOverflowing ? (
          <span className="pill" title="Scroll inside the preview to see the rest">
            scroll
          </span>
        ) : null}
        <span className="muted">{decision.security.byteSize} bytes</span>
        {decision.themeRepairs.length > 0 ? (
          <span className="pill" title="Hard-coded light surfaces adjusted for theme">
            theme adjusted ({decision.themeRepairs.length})
          </span>
        ) : null}
        {decision.layoutRepairs.length > 0 ? (
          <span className="pill" title="Viewport-unit heights neutralized for inline layout">
            layout adjusted ({decision.layoutRepairs.length})
          </span>
        ) : null}
        {extraHeaderAction ?? null}
      </div>
      {granted ? (
        <iframe
          ref={iframeRef as RefObject<HTMLIFrameElement>}
          className="artifact-iframe"
          title={decision.descriptor.title}
          srcDoc={decision.srcdoc}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={
            isCanvas
              ? { minHeight: '100%', height: '100%', maxHeight: '100%', width: '100%', border: 0 }
              : {
                  minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
                  height,
                  maxHeight,
                  width: '100%',
                  border: 0,
                }
          }
        />
      ) : (
        <p className="muted">Waiting for artifact init slot…</p>
      )}
    </div>
  );
}
