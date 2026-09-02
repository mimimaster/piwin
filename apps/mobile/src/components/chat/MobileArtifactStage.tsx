import { useState, type ReactElement } from 'react';
import { IconExpand, IconSpark } from '@piwin/ui-kit';
import {
  mobileArtifactBlockedCopy,
  mobileArtifactSrcdoc,
  type MobileArtifactPreview,
} from '../../mobile-artifact-preview.js';
import { MobileArtifactSheet } from '../modals/MobileArtifactSheet.js';

export type MobileArtifactStageProps = {
  preview: MobileArtifactPreview;
};

/**
 * Host-owned viewport in the transcript. The iframe scrolls itself;
 * the session scroller keeps the rest of the thread.
 */
export function MobileArtifactStage({ preview }: MobileArtifactStageProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const plan = preview.plan;
  const canExpand = plan.kind === 'render';

  return (
    <>
      <section className="mobile-artifact-stage" data-testid="mobile-artifact-stage">
        <header className="mobile-artifact-stage-header">
          <div className="mobile-artifact-stage-identity">
            <span className="mobile-artifact-stage-icon" aria-hidden="true">
              <IconSpark size={16} />
            </span>
            <div className="mobile-artifact-stage-copy">
              <h3 className="mobile-artifact-stage-title">{preview.title}</h3>
              <p className="mobile-artifact-stage-meta">{preview.language.toUpperCase()} · 沙箱</p>
            </div>
          </div>
          {canExpand ? (
            <button
              type="button"
              className="mobile-artifact-stage-expand"
              onClick={() => setExpanded(true)}
              aria-label="全屏预览"
            >
              <IconExpand size={16} />
            </button>
          ) : null}
        </header>

        {plan.kind === 'blocked' ? (
          <p className="mobile-artifact-stage-blocked">{mobileArtifactBlockedCopy(plan.reason)}</p>
        ) : plan.kind === 'render' && !expanded ? (
          <div className="mobile-artifact-stage-viewport">
            <iframe
              title={preview.title}
              srcDoc={mobileArtifactSrcdoc(plan)}
              className="mobile-artifact-stage-iframe"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
      </section>

      <MobileArtifactSheet
        isOpen={expanded}
        onClose={() => setExpanded(false)}
        title={preview.title}
        srcdoc={mobileArtifactSrcdoc(plan)}
        blockedReason={plan.kind === 'blocked' ? mobileArtifactBlockedCopy(plan.reason) : undefined}
      />
    </>
  );
}

export function MobileArtifactPending({ title }: { title: string }): ReactElement {
  return (
    <div className="mobile-artifact-stage is-pending" data-testid="mobile-artifact-pending">
      <header className="mobile-artifact-stage-header">
        <div className="mobile-artifact-stage-identity">
          <span className="mobile-artifact-stage-icon" aria-hidden="true">
            <IconSpark size={16} />
          </span>
          <div className="mobile-artifact-stage-copy">
            <h3 className="mobile-artifact-stage-title">{title}</h3>
            <p className="mobile-artifact-stage-meta">正在生成网页产物…</p>
          </div>
        </div>
      </header>
    </div>
  );
}
