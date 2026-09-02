import {
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
  type ArtifactFrameMode,
  type ArtifactRenderPlan,
} from '@piwin/artifact';
import { Button, Spinner } from '@piwin/ui-kit';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { useArtifactFrameBridge } from './artifact-frame-bridge.js';
import { useArtifactFrameLease } from './artifact-frame-lifecycle.js';
import {
  useArtifactDocument,
  useArtifactStreamPublisher,
  type ArtifactSandboxView,
} from './artifact-frame-stream.js';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';
import { useTranscriptScrollPort } from './transcript-scroll-port.js';

const ARTIFACT_ACTIVITY_ANIMATION = getBehaviorActivitySpec('artifact').animation;

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
  extraHeaderAction?: ReactElement;
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
  const scrollPort = useTranscriptScrollPort();
  const bootstrapHeight = resolveBootstrapHeight(props.plan, props.presentation, frameWidth);
  const measureHeight = props.presentation === 'inline' && plannedFrameMode === 'inline-flow';
  const bridge = useArtifactFrameBridge({
    channelId,
    documentKey: document.documentKey,
    decision: view,
    iframeRef,
    enabled: lease.hostIframe && lease.initGranted,
    measureHeight,
    bootstrapHeight,
    frameMode: plannedFrameMode,
    presentation: props.presentation,
    ...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {}),
    ...(props.onComposerProposal ? { onComposerProposal: props.onComposerProposal } : {}),
    ...(scrollPort ? { onContentGrew: scrollPort.notifyContentGrew } : {}),
  });
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
    enabled: lease.hostIframe && lease.initGranted,
    streamLifecycle: document.streamLifecycle,
  });
  const canvas = props.presentation === 'canvas';
  const viewportChrome = hostOwnsViewport(appliedFrameMode, bridge.overflowsInlineFlow);
  const showOverflowHint = !canvas && appliedFrameMode === 'inline-overflow';
  const preparingStableSnapshot =
    view.mode === 'stream-preview' && props.plan.renderSource.trim().length === 0;
  const toolStatus = bridge.status === 'ready' || bridge.status === 'fallback' ? 'done' : 'running';
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
          {showOverflowHint ? (
            <p
              className="artifact-overflow-hint"
              data-testid="artifact-overflow-hint"
              role="status"
              aria-live="polite"
            >
              {artifactOverflowHintCopy(props.locale)}
            </p>
          ) : null}
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
                : inlineStageStyle(bridge.height, appliedFrameMode, bridge.overflowsInlineFlow)
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
                    {props.locale === 'zh-CN' ? '正在准备稳定画面…' : 'Preparing a stable preview…'}
                  </span>
                </div>
              </div>
            ) : null}
            {lease.initGranted ? (
              <iframe
                ref={iframeRef}
                className={`artifact-iframe${viewportChrome || canvas ? ' artifact-iframe--scroll-owner' : ''}`}
                title={view.descriptor.title}
                src={document.documentUrl}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                data-frame-mode={appliedFrameMode}
                onLoad={() => {
                  lease.markIframeLoaded();
                  bridge.onIframeLoad();
                  streamPublisher.onIframeLoad();
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
        </>
      )}
    </div>
  );
}
