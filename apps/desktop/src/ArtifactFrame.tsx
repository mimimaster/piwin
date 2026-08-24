import { useRef, type ReactElement } from 'react';
import type {
  ArtifactActionMessage,
  ArtifactRenderPlan,
  ArtifactThemeVariables,
} from '@piwin/artifact';
import {
  ARTIFACT_BOOTSTRAP_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  estimateSvgFenceHeight,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { useArtifactFrameBridge } from './artifact-frame-bridge.js';
import { useArtifactFrameHost } from './artifact-frame-host.js';
import {
  useArtifactDocument,
  useArtifactStreamPublisher,
  type ArtifactSandboxView,
} from './artifact-frame-stream.js';
import { useTranscriptScrollPort } from './transcript-scroll-port.js';
import { ArtifactStatic } from './ArtifactStatic.js';

const ARTIFACT_ACTIVITY_ANIMATION = getBehaviorActivitySpec('artifact').animation;

export type ArtifactFramePlan = Extract<ArtifactRenderPlan, { kind: 'render' } | { kind: 'blocked' }>;

export type ArtifactFrameProps = {
  plan: ArtifactFramePlan;
  initPriority?: number;
  presentation?: 'inline' | 'canvas';
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  extraHeaderAction?: ReactElement;
  theme?: ArtifactThemeVariables;
  locale?: 'zh-CN' | 'en';
};

type SandboxPlan = Extract<ArtifactRenderPlan, { kind: 'render' }> & {
  document: { kind: 'sandbox'; srcdoc: string; csp: string };
};

function sandboxViewFromPlan(plan: SandboxPlan): ArtifactSandboxView {
  return {
    mode: plan.mode,
    descriptor: plan.intent.descriptor,
    renderSource: plan.renderSource,
    srcdoc: plan.document.srcdoc,
  };
}

function resolveBootstrapHeight(plan: SandboxPlan, presentation: 'inline' | 'canvas'): number {
  if (presentation === 'canvas' || plan.intent.descriptor.type !== 'svg') {
    return ARTIFACT_BOOTSTRAP_HEIGHT;
  }
  const source = plan.mode === 'stream-preview' ? plan.renderSource : plan.intent.descriptor.source;
  const viewportWidth =
    typeof window === 'undefined' ? 640 : Math.max(280, Math.min(window.innerWidth - 120, 780));
  return estimateSvgFenceHeight({
    source,
    containerWidth: viewportWidth,
    minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
    maxHeight: MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
    fallbackHeight: ARTIFACT_BOOTSTRAP_HEIGHT,
  });
}

export function ArtifactFrame({
  plan,
  initPriority = 0,
  presentation = 'inline',
  onArtifactAction,
  onComposerProposal,
  extraHeaderAction,
  theme,
  locale = 'en',
}: ArtifactFrameProps): ReactElement {
  if (plan.kind === 'blocked') {
    const contentLabel = plan.descriptor.type === 'svg' ? 'SVG' : 'HTML UI';
    return (
      <div
        data-testid="artifact-frame"
        data-activity-id="artifact"
        data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
        data-tool-status="error"
        data-artifact-layout={presentation}
        className={`artifact-frame blocked${presentation === 'canvas' ? ' presentation-canvas' : ''}`}
      >
        {extraHeaderAction ? (
          <div className="artifact-frame-actions">{extraHeaderAction}</div>
        ) : null}
        <p className="muted">
          Cannot preview this {contentLabel}: <code>{plan.reason}</code>
          {plan.capabilities.externalResources.length > 0
            ? ` (${plan.capabilities.externalResources.length} external resource(s))`
            : ''}
        </p>
      </div>
    );
  }

  const document = plan.document;
  if (document.kind === 'static-source') {
    return (
      <div
        data-testid="artifact-frame"
        data-activity-id="artifact"
        data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
        data-tool-status="done"
        data-artifact-renderer="static-flow"
        data-artifact-layout="inline"
        className={`artifact-frame artifact-frame--static${extraHeaderAction ? ' has-artifact-action' : ''}`}
      >
        {extraHeaderAction ? (
          <div className="artifact-frame-actions">{extraHeaderAction}</div>
        ) : null}
        <ArtifactStatic
          source={document.source}
          type={plan.intent.descriptor.type}
          {...(theme ? { theme } : {})}
        />
      </div>
    );
  }

  const sandboxPlan: SandboxPlan = { ...plan, document };
  return (
    <ArtifactRenderFrame
      key={plan.intent.descriptor.id}
      plan={sandboxPlan}
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
  plan: SandboxPlan;
  initPriority: number;
  presentation: 'inline' | 'canvas';
  locale: 'zh-CN' | 'en';
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  extraHeaderAction?: ReactElement;
}): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const view = sandboxViewFromPlan(props.plan);
  const channelId = view.descriptor.id;
  const document = useArtifactDocument(view);
  const host = useArtifactFrameHost({
    channelId,
    initPriority: props.initPriority,
    presentation: props.presentation,
    streaming: view.mode === 'stream-preview',
  });
  const scrollPort = useTranscriptScrollPort();
  const bootstrapHeight = resolveBootstrapHeight(props.plan, props.presentation);
  const bridge = useArtifactFrameBridge({
    channelId,
    documentKey: document.documentKey,
    decision: view,
    iframeRef,
    enabled: host.hostIframe && host.initGranted,
    measureHeight: props.presentation === 'inline',
    bootstrapHeight,
    presentation: props.presentation,
    ...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {}),
    ...(props.onComposerProposal ? { onComposerProposal: props.onComposerProposal } : {}),
    ...(scrollPort ? { onContentGrew: scrollPort.notifyContentGrew } : {}),
  });
  const streamPublisher = useArtifactStreamPublisher({
    channelId,
    decision: view,
    iframeRef,
    enabled: host.hostIframe && host.initGranted,
    streamLifecycle: document.streamLifecycle,
  });
  const canvas = props.presentation === 'canvas';
  const toolStatus = bridge.status === 'ready' || bridge.status === 'fallback' ? 'done' : 'running';
  const pausedLabel =
    props.locale === 'zh-CN' ? '预览已暂停以节省内存' : 'Preview paused to save memory';

  return (
    <div
      data-testid="artifact-frame"
      data-activity-id="artifact"
      data-activity-animation={ARTIFACT_ACTIVITY_ANIMATION}
      data-tool-status={toolStatus}
      data-artifact-host={host.hostIframe ? 'live' : 'recycled'}
      data-artifact-height-status={bridge.status}
      data-artifact-renderer="sandbox"
      data-artifact-layout={canvas ? 'canvas' : 'inline'}
      className={`artifact-frame${canvas ? ' presentation-canvas' : ''}${props.extraHeaderAction ? ' has-artifact-action' : ''}${host.hostIframe ? '' : ' is-recycled'}`}
    >
      {props.extraHeaderAction ? (
        <div className="artifact-frame-actions">{props.extraHeaderAction}</div>
      ) : null}

      {!host.hostIframe ? (
        <div
          className="artifact-iframe-placeholder artifact-iframe-placeholder--recycled"
          data-testid="artifact-iframe-placeholder"
          style={{
            minHeight: Math.max(bridge.height, 88),
            height: Math.max(bridge.height, 88),
            maxHeight: MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
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
              onClick={host.requestHost}
            >
              {props.locale === 'zh-CN' ? '加载预览' : 'Load preview'}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="artifact-iframe-stage"
          style={
            canvas
              ? { minHeight: '100%', height: '100%', maxHeight: '100%', width: '100%' }
              : {
                  minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
                  height: bridge.height,
                  maxHeight: MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
                  width: '100%',
                  overflow: 'hidden',
                }
          }
        >
          {host.initGranted ? (
            <iframe
              ref={iframeRef}
              className="artifact-iframe"
              title={view.descriptor.title}
              src={document.documentUrl}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              onLoad={() => {
                host.markIframeLoaded();
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
      )}
    </div>
  );
}
