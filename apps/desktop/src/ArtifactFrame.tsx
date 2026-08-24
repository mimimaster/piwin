import type { ReactElement } from 'react';
import type {
  ArtifactActionMessage,
  ArtifactRenderPlan,
  ArtifactThemeVariables,
} from '@piwin/artifact';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import {
  ArtifactSandboxFrame,
  type ArtifactSandboxPlan,
} from './artifact-sandbox-frame.js';
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
          locale={locale}
          {...(theme ? { theme } : {})}
        />
      </div>
    );
  }

  const sandboxPlan: ArtifactSandboxPlan = { ...plan, document };
  return (
    <ArtifactSandboxFrame
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
