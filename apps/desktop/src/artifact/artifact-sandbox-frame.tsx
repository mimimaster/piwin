import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  ARTIFACT_BOOTSTRAP_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  advanceArtifactFrameMode,
  estimateSvgFenceHeight,
  type ArtifactActionMessage,
  type ArtifactContrastMessage,
  type ArtifactErrorMessage,
  type ArtifactFrameMode,
  type ArtifactRenderPlan,
} from '@piwin/artifact';
import { Button, Spinner } from '@piwin/ui-kit';
import { getBehaviorActivitySpec } from '../run-activity/behavior-activity.js';
import { useArtifactDocumentHandoff } from './artifact-document-handoff.js';
import { useArtifactFrameBridge } from './artifact-frame-bridge.js';
import {
  toArtifactTextSelection,
  type ArtifactTextSelection,
} from './artifact-canvas-selection.js';
import { useArtifactFrameLease } from './artifact-frame-lifecycle.js';
import { useArtifactDocument, type ArtifactSandboxView } from './artifact-document.js';
import { useArtifactStreamPublisher } from './artifact-frame-stream.js';
import { usePublishedArtifactDocument } from './artifact-document-publication.js';
import { ArtifactSandboxNotices } from './artifact-sandbox-notices.js';
import type { ArtifactStyleOverride } from './artifact-style-override.js';
import { useTranscriptScrollPort } from '../conversation/transcript-scroll-port.js';
import { readRememberedArtifactHeight, rememberArtifactHeight } from './artifact-height-memory.js';

const ARTIFACT_ACTIVITY_ANIMATION = getBehaviorActivitySpec('artifact').animation;
/**
 * Inline stream floor. The empty shell reports ~8px, which clamped to 40px and
 * cropped the preparing placeholder to a bare spinner while the model wrote
 * CSS. Holding it until the stream ends also avoids a 120 → 40 dip when the
 * first short snapshot (often just a title) replaces the placeholder.
 */
const ARTIFACT_STREAM_MIN_HEIGHT = 120;

function formatReceivedSource(source: string, locale: 'zh-CN' | 'en'): string {
  const bytes = new TextEncoder().encode(source).length;
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  return locale === 'zh-CN' ? `已接收 ${size}` : `${size} received`;
}

export type ArtifactSandboxPlan = Extract<ArtifactRenderPlan, { kind: 'render' }> & {
  document: { kind: 'sandbox'; srcdoc: string; csp: string };
};

function sandboxViewFromPlan(plan: ArtifactSandboxPlan): ArtifactSandboxView {
  return {
    mode: plan.mode,
    descriptor: plan.intent.descriptor,
    renderSource: plan.renderSource,
    srcdoc: plan.document.srcdoc,
    frameMode: plan.frameMode,
  };
}

function resolveBootstrapHeight(
  plan: ArtifactSandboxPlan,
  presentation: 'inline' | 'canvas',
  containerWidth?: number | null,
): number {
  if (presentation === 'canvas' || plan.intent.descriptor.type !== 'svg') {
    return ARTIFACT_BOOTSTRAP_HEIGHT;
  }
  const source = plan.mode === 'stream-preview' ? plan.renderSource : plan.intent.descriptor.source;
  const fallbackWidth = typeof window === 'undefined' ? 640 : window.innerWidth - 120;
  const measuredWidth =
    containerWidth !== undefined && containerWidth !== null ? containerWidth : fallbackWidth;
  const viewportWidth = Math.max(1, Math.min(measuredWidth, 780));
  return estimateSvgFenceHeight({
    source,
    containerWidth: viewportWidth,
    minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
    maxHeight: MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
    fallbackHeight: ARTIFACT_BOOTSTRAP_HEIGHT,
  });
}

function requestedFrameMode(
  plan: ArtifactSandboxPlan,
  presentation: 'inline' | 'canvas',
): ArtifactFrameMode {
  return presentation === 'canvas' ? 'canvas' : plan.frameMode;
}

function hostOwnsViewport(frameMode: ArtifactFrameMode, overflowsInlineFlow: boolean): boolean {
  return frameMode === 'inline-viewport' || frameMode === 'inline-overflow' || overflowsInlineFlow;
}

function inlineStageStyle(
  height: number,
  frameMode: ArtifactFrameMode,
  overflowsInlineFlow: boolean,
): CSSProperties {
  const viewport = hostOwnsViewport(frameMode, overflowsInlineFlow);
  return {
    minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
    height,
    maxHeight: viewport ? height : MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
    width: '100%',
    overflow: 'hidden',
    overscrollBehavior: viewport ? 'contain' : undefined,
  };
}

export function ArtifactSandboxFrame(props: {
  plan: ArtifactSandboxPlan;
  initPriority: number;
  presentation: 'inline' | 'canvas';
  locale: 'zh-CN' | 'en';
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  /** Canvas only: the reader's text selection inside the frame, or null. */
  onTextSelection?: (selection: ArtifactTextSelection | null) => void;
  extraHeaderAction?: ReactElement;
  styleOverride?: ArtifactStyleOverride;
}): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const observedFrame: HTMLDivElement = frame;

    function updateFrameWidth(): void {
      const width = observedFrame.clientWidth;
      if (width > 0) {
        setFrameWidth((current) => (current === width ? current : width));
      }
    }

    updateFrameWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateFrameWidth);
      observer.observe(observedFrame);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateFrameWidth);
    return () => window.removeEventListener('resize', updateFrameWidth);
  }, []);
  const view = sandboxViewFromPlan(props.plan);
  const channelId = view.descriptor.id;
  const nextFrameMode = requestedFrameMode(props.plan, props.presentation);
  const [runtimeFrameMode, setRuntimeFrameMode] = useState(nextFrameMode);
  const plannedFrameMode = advanceArtifactFrameMode(runtimeFrameMode, nextFrameMode);
  if (plannedFrameMode !== runtimeFrameMode) {
    setRuntimeFrameMode(plannedFrameMode);
  }
  const document = useArtifactDocument(view);
  const lease = useArtifactFrameLease({
    channelId,
    initPriority: props.initPriority,
    presentation: props.presentation,
    streaming: view.mode === 'stream-preview',
  });
  const publication = usePublishedArtifactDocument(document, lease.hostIframe && lease.initGranted);
  const documentReady = publication.status === 'ready';
  const scrollPort = useTranscriptScrollPort();
  const measureHeight = props.presentation === 'inline' && plannedFrameMode === 'inline-flow';
  // A final inline document starts at the height it had last time it mounted.
  const remembersHeight = measureHeight && !document.streamLifecycle;
  const rememberedHeight = remembersHeight
    ? readRememberedArtifactHeight(channelId, frameWidth)
    : null;
  const bootstrapHeight =
    rememberedHeight ?? resolveBootstrapHeight(props.plan, props.presentation, frameWidth);
  // First script failure of the current document. A broken artifact used to
  // show whatever placeholder its author left behind ("enable JavaScript"),
  // which reads as a platform block rather than the author's own bug.
  const [scriptError, setScriptError] = useState<ArtifactErrorMessage | null>(null);
  const [contrastIssue, setContrastIssue] = useState<ArtifactContrastMessage | null>(null);
  const [shatteredText, setShatteredText] = useState(0);
  const scriptErrorDocumentRef = useRef<string | null>(null);
  if (scriptErrorDocumentRef.current !== document.documentKey) {
    scriptErrorDocumentRef.current = document.documentKey;
    if (scriptError !== null) setScriptError(null);
    if (contrastIssue !== null) setContrastIssue(null);
    if (shatteredText !== 0) setShatteredText(0);
  }
  const textSelectionRef = useRef(props.onTextSelection);
  textSelectionRef.current = props.onTextSelection;
  // A replaced document (stream → final, theme remount) takes its selection
  // with it; the host's button must not outlive the text it points at.
  useEffect(() => {
    textSelectionRef.current?.(null);
  }, [document.documentKey]);
  const bridge = useArtifactFrameBridge({
    channelId,
    documentKey: document.documentKey,
    decision: view,
    iframeRef,
    enabled: lease.hostIframe && lease.initGranted && documentReady,
    measureHeight,
    bootstrapHeight,
    frameMode: plannedFrameMode,
    presentation: props.presentation,
    ...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {}),
    ...(props.onComposerProposal ? { onComposerProposal: props.onComposerProposal } : {}),
    ...(scrollPort ? { onContentGrew: scrollPort.notifyContentGrew } : {}),
    onScriptError: (error) => setScriptError((current) => current ?? error),
    onContrastIssue: (issue) => setContrastIssue((current) => current ?? issue),
    onLayoutIssue: (issue) => setShatteredText(issue.shatteredText),
    ...(props.onTextSelection
      ? {
          onTextSelection: (message) =>
            textSelectionRef.current?.(toArtifactTextSelection(message, iframeRef.current)),
        }
      : {}),
  });
  useEffect(() => {
    if (remembersHeight && bridge.status === 'ready' && !bridge.overflowsInlineFlow) {
      rememberArtifactHeight(channelId, frameWidth, bridge.height);
    }
  }, [
    bridge.height,
    bridge.overflowsInlineFlow,
    bridge.status,
    channelId,
    frameWidth,
    remembersHeight,
  ]);
  const appliedFrameMode = bridge.overflowsInlineFlow
    ? advanceArtifactFrameMode(plannedFrameMode, 'inline-overflow')
    : plannedFrameMode;
  if (appliedFrameMode !== runtimeFrameMode) {
    setRuntimeFrameMode(appliedFrameMode);
  }
  const streamPublisher = useArtifactStreamPublisher({
    channelId,
    decision: view,
    frameMode: appliedFrameMode,
    iframeRef,
    enabled: lease.hostIframe && lease.initGranted && documentReady,
    streamLifecycle: document.streamLifecycle,
  });
  const canvas = props.presentation === 'canvas';
  const handoff = useArtifactDocumentHandoff({
    channelId,
    document,
    iframeRef,
    enabled: canvas && lease.hostIframe && lease.initGranted && publication.error === null,
  });
  const viewportChrome = hostOwnsViewport(appliedFrameMode, bridge.overflowsInlineFlow);
  const showOverflowHint = !canvas && appliedFrameMode === 'inline-overflow';
  const [paintedDocumentKey, setPaintedDocumentKey] = useState<string | null>(null);
  const preparingStableSnapshot =
    view.mode === 'stream-preview' &&
    (props.plan.renderSource.trim().length === 0 ||
      !document.streamSeeded ||
      paintedDocumentKey !== document.documentKey);
  const toolStatus =
    publication.status === 'error' || (documentReady && bridge.status === 'fallback')
      ? 'error'
      : documentReady && bridge.status === 'ready'
        ? 'done'
        : 'running';
  const stageHeight =
    view.mode === 'stream-preview' && !canvas && !viewportChrome
      ? Math.max(bridge.height, ARTIFACT_STREAM_MIN_HEIGHT)
      : bridge.height;
  const pausedLabel =
    props.locale === 'zh-CN' ? '预览已暂停以节省内存' : 'Preview paused to save memory';

  return (
    <div
      ref={frameRef}
      data-testid="artifact-frame"
      data-activity-id="artifact"
      data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
      data-tool-status={toolStatus}
      data-artifact-host={lease.hostIframe ? 'live' : 'recycled'}
      data-artifact-lifecycle={lease.state}
      data-artifact-height-status={bridge.status}
      data-artifact-document-status={publication.status}
      data-artifact-renderer="sandbox"
      data-artifact-layout={canvas ? 'canvas' : 'inline'}
      data-frame-mode={appliedFrameMode}
      data-content-height={String(bridge.contentHeight)}
      className={`artifact-frame${canvas ? ' presentation-canvas' : ''}${props.extraHeaderAction ? ' has-artifact-action' : ''}${lease.hostIframe ? '' : ' is-recycled'}`}
    >
      {props.extraHeaderAction ? (
        <div className="artifact-frame-actions">{props.extraHeaderAction}</div>
      ) : null}

      {!lease.hostIframe ? (
        <div
          className="artifact-iframe-placeholder artifact-iframe-placeholder--recycled"
          data-testid="artifact-iframe-placeholder"
          style={{
            minHeight: Math.max(bridge.height, 88),
            height: Math.max(bridge.height, 88),
            maxHeight: viewportChrome ? bridge.height : MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
            width: '100%',
          }}
        >
          <span className="artifact-preparing-sheen" aria-hidden="true" />
          <div className="artifact-iframe-placeholder-body">
            <span className="artifact-iframe-placeholder-copy">{pausedLabel}</span>
            <Button
              size="compact"
              className="artifact-iframe-load-btn"
              data-testid="artifact-load-preview"
              onClick={lease.requestHost}
            >
              {props.locale === 'zh-CN' ? '加载预览' : 'Load preview'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ArtifactSandboxNotices
            locale={props.locale}
            publication={publication}
            overflowHint={showOverflowHint}
            scriptError={scriptError}
            contrastIssue={contrastIssue}
            shatteredText={shatteredText}
            {...(props.styleOverride ? { styleOverride: props.styleOverride } : {})}
            {...(props.onComposerProposal ? { onComposerProposal: props.onComposerProposal } : {})}
            heightRecovery={
              !canvas && bridge.status === 'fallback' && view.mode !== 'stream-preview'
            }
            retryMeasurement={bridge.retryMeasurement}
          />
          {publication.status !== 'error' ? (
            <div
              className="artifact-iframe-stage"
              style={
                canvas
                  ? {
                      minHeight: '100%',
                      height: '100%',
                      maxHeight: '100%',
                      width: '100%',
                      overflow: 'hidden',
                      overscrollBehavior: 'contain',
                    }
                  : inlineStageStyle(stageHeight, appliedFrameMode, bridge.overflowsInlineFlow)
              }
            >
              {preparingStableSnapshot ? (
                <div
                  className="artifact-iframe-placeholder"
                  data-testid="artifact-stream-preparing"
                  style={{ position: 'absolute', inset: 0, zIndex: 1 }}
                >
                  <span className="artifact-preparing-sheen" aria-hidden="true" />
                  <div className="artifact-iframe-placeholder-body">
                    <Spinner
                      label={
                        props.locale === 'zh-CN' ? '正在准备稳定画面' : 'Preparing a stable preview'
                      }
                    />
                    <span className="artifact-iframe-placeholder-copy" aria-hidden="true">
                      {props.locale === 'zh-CN'
                        ? '正在准备稳定画面…'
                        : 'Preparing a stable preview…'}
                    </span>
                    <span
                      className="artifact-iframe-placeholder-meta"
                      data-testid="artifact-stream-received"
                      aria-hidden="true"
                    >
                      {formatReceivedSource(view.descriptor.source, props.locale)}
                    </span>
                  </div>
                </div>
              ) : null}
              {handoff.outgoing ? (
                <iframe
                  key={handoff.outgoing.documentId}
                  ref={handoff.outgoingRef}
                  className="artifact-iframe artifact-iframe--scroll-owner artifact-iframe--outgoing"
                  title=""
                  aria-hidden="true"
                  tabIndex={-1}
                  src={handoff.outgoing.documentUrl}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  data-testid="artifact-iframe-outgoing"
                />
              ) : null}
              {lease.initGranted && documentReady ? (
                <iframe
                  // Canvas swaps documents by mounting the successor beside the
                  // one it replaces; Inline keeps navigating a single element.
                  key={canvas ? document.documentId : 'artifact-iframe'}
                  ref={iframeRef}
                  className={`artifact-iframe${viewportChrome || canvas ? ' artifact-iframe--scroll-owner' : ''}${handoff.outgoing ? ' artifact-iframe--incoming' : ''}`}
                  title={view.descriptor.title}
                  src={document.documentUrl}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  data-frame-mode={appliedFrameMode}
                  onLoad={() => {
                    lease.markIframeLoaded();
                    bridge.onIframeLoad();
                    streamPublisher.onIframeLoad();
                    handoff.onIncomingLoad();
                    setPaintedDocumentKey(document.documentKey);
                  }}
                  style={
                    canvas
                      ? {
                          minHeight: '100%',
                          height: '100%',
                          maxHeight: '100%',
                          width: '100%',
                          border: 0,
                        }
                      : {
                          minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
                          height: '100%',
                          maxHeight: '100%',
                          width: '100%',
                          border: 0,
                        }
                  }
                />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
