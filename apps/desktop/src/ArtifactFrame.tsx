import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import type { ArtifactActionMessage, ArtifactPreviewDecision } from '@piwin/artifact';
import {
  ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS,
  ARTIFACT_READY_TIMEOUT_MS,
  INITIAL_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_EXPANDED_HEIGHT,
  MAX_ARTIFACT_IFRAME_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
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

export type ArtifactFrameProps = {
  decision:
    | Extract<ArtifactPreviewDecision, { kind: 'render' } | { kind: 'blocked' } | { kind: 'preparing' }>;
  /** Higher = sooner init when many artifacts mount (history). */
  initPriority?: number;
  /**
   * Validated whitelisted action from the sandboxed artifact (e.g. flashcard
   * rating). Absent = actions are ignored (render-only artifact).
   */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
};

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
  onArtifactAction,
}: ArtifactFrameProps): ReactElement {
  if (decision.kind === 'blocked') {
    return (
      <div className="artifact-frame blocked">
        <div className="artifact-frame-header">
          <strong>{decision.descriptor.title}</strong>
          <span className="pill">blocked</span>
        </div>
        <p className="muted">
          Cannot preview this HTML UI: <code>{decision.reason}</code>
          {decision.security.externalResources.length > 0
            ? ` (${decision.security.externalResources.length} external resource(s))`
            : ''}
        </p>
        <details>
          <summary>Source</summary>
          <pre className="md-code">
            <code>{decision.descriptor.source}</code>
          </pre>
        </details>
      </div>
    );
  }

  if (decision.kind === 'preparing') {
    return (
      <div className="artifact-frame preparing">
        <div className="artifact-frame-header">
          <strong>{decision.descriptor.title}</strong>
          <span className="pill">streaming</span>
        </div>
        <p className="muted">{decision.message}</p>
        <details>
          <summary>Source so far</summary>
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
      {...(onArtifactAction ? { onArtifactAction } : {})}
    />
  );
}

function ArtifactRenderFrame(props: {
  decision: Extract<ArtifactPreviewDecision, { kind: 'render' }>;
  initPriority: number;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
}): ReactElement {
  const { decision, initPriority, onArtifactAction } = props;
  const channelId =
    decision.mode === 'stream-preview'
      ? `${decision.descriptor.id}-stream`
      : decision.descriptor.id;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [granted, setGranted] = useState(false);
  const [height, setHeight] = useState(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<ArtifactHeightPhase>('protected');
  const [statusLabel, setStatusLabel] = useState<'loading' | 'ready' | 'timeout' | 'streaming'>(
    decision.mode === 'stream-preview' ? 'streaming' : 'loading',
  );
  const floorRef = useRef(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const heightRef = useRef(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  const phaseRef = useRef<ArtifactHeightPhase>('protected');
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shrinkPendingRef = useRef<number | null>(null);
  const maxHeight = expanded
    ? MAX_ARTIFACT_EXPANDED_HEIGHT
    : MAX_ARTIFACT_IFRAME_HEIGHT;

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
      releaseArtifactInit(channelId);
      if (shrinkTimerRef.current) {
        clearTimeout(shrinkTimerRef.current);
        shrinkTimerRef.current = null;
      }
    };
  }, [channelId, initPriority]);

  // Height bridge listener
  useEffect(() => {
    if (!granted) {
      return;
    }

    const applyHeight = (nextHeight: number): void => {
      const clamped = clampArtifactHeight(
        nextHeight,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        maxHeight,
        INITIAL_ARTIFACT_IFRAME_HEIGHT,
      );
      floorRef.current = Math.max(floorRef.current, clamped);
      setHeight(clamped);
    };

    const onMessage = (event: MessageEvent): void => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (iframeWindow && event.source && event.source !== iframeWindow) {
        return;
      }

      // Whitelisted user-intent actions (flashcard rating etc). Same origin
      // checks as height bridge: event.source + channelId must match.
      const actionMessage = parseArtifactActionMessage(event.data);
      if (actionMessage) {
        if (actionMessage.channelId === channelId && onArtifactAction) {
          onArtifactAction(actionMessage);
        }
        return;
      }

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
        setPhase('interactive');
        setStatusLabel(decision.mode === 'stream-preview' ? 'streaming' : 'ready');
      }
    };

    window.addEventListener('message', onMessage);

    const readyTimeout = window.setTimeout(() => {
      if (phaseRef.current === 'protected') {
        setPhase('interactive');
        setStatusLabel('timeout');
      }
    }, ARTIFACT_READY_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(readyTimeout);
    };
  }, [granted, channelId, decision.mode, maxHeight]);

  // When collapsing expand mode, re-clamp height to the default max.
  useEffect(() => {
    if (!expanded && height > MAX_ARTIFACT_IFRAME_HEIGHT) {
      setHeight(MAX_ARTIFACT_IFRAME_HEIGHT);
      floorRef.current = Math.min(floorRef.current, MAX_ARTIFACT_IFRAME_HEIGHT);
    }
  }, [expanded, height]);

  // Reset height state when srcdoc identity changes
  useEffect(() => {
    setHeight(INITIAL_ARTIFACT_IFRAME_HEIGHT);
    floorRef.current = INITIAL_ARTIFACT_IFRAME_HEIGHT;
    setPhase('protected');
    setStatusLabel(decision.mode === 'stream-preview' ? 'streaming' : 'loading');
    setExpanded(false);
  }, [decision.srcdoc, decision.mode]);

  const modePill =
    decision.mode === 'stream-preview'
      ? 'stream'
      : statusLabel === 'ready'
        ? 'preview'
        : statusLabel;

  return (
    <div className="artifact-frame">
      <div className="artifact-frame-header">
        <strong>{decision.descriptor.title}</strong>
        <span className={statusLabel === 'ready' || decision.mode === 'stream-preview' ? 'pill ok' : 'pill'}>
          {modePill}
        </span>
        <span className="muted">{decision.security.byteSize} bytes</span>
        {decision.themeRepairs.length > 0 ? (
          <span className="pill" title="Hard-coded light surfaces adjusted for theme">
            theme adjusted ({decision.themeRepairs.length})
          </span>
        ) : null}
        <button
          type="button"
          className="btn ghost artifact-expand-toggle"
          onClick={() => setExpanded((previous) => !previous)}
          title={
            expanded
              ? `Collapse to ${MAX_ARTIFACT_IFRAME_HEIGHT}px max`
              : `Expand up to ${MAX_ARTIFACT_EXPANDED_HEIGHT}px`
          }
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {granted ? (
        <iframe
          ref={iframeRef as RefObject<HTMLIFrameElement>}
          className="artifact-iframe"
          title={decision.descriptor.title}
          srcDoc={decision.srcdoc}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{
            minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
            height,
            maxHeight,
            width: '100%',
            border: 0,
          }}
        />
      ) : (
        <p className="muted">Waiting for artifact init slot…</p>
      )}
      <details>
        <summary>Source (raw model HTML)</summary>
        <pre className="md-code">
          <code>{decision.descriptor.source}</code>
        </pre>
      </details>
    </div>
  );
}
