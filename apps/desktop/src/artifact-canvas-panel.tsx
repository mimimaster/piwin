/**
 * Right-side Artifact Canvas shell.
 *
 * Renders the active Canvas target through `ArtifactFrame presentation="canvas"`
 * so the same sandbox/CSP/bridge path serves both Inline and Canvas surfaces
 * (ADR 0029). Shows an empty state when the Canvas tab is restored without a
 * target after a full reload — Canvas is message-backed and ephemeral, so no
 * stale source is ever rendered.
 *
 * Composer proposals (ADR 0029 §2.6) are stored here in trusted parent state
 * and require an explicit user click before the caller appends them to the
 * Composer. The iframe cannot replace the draft, send a prompt, or invoke any
 * other product capability.
 */

import { useMemo, useState, type ReactElement } from 'react';
import {
  materializeArtifact,
  type ArtifactThemeVariables,
  type ComposerProposeTextActionPayload,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';

export type ArtifactCanvasProposal = ComposerProposeTextActionPayload;

export type ArtifactCanvasPanelProps = {
  activeTarget: ArtifactCanvasTarget | null;
  /** Theme variables for the sandboxed document; remounts on key change. */
  artifactTheme?: ArtifactThemeVariables;
  /** Bumped on theme switch so ArtifactFrame remounts with new tokens. */
  artifactThemeKey?: string | number;
  /** Security byte cap forwarded when the stored intent is materialized. */
  artifactMaxBytes?: number;
  /**
   * Insert the accepted proposal into the Composer. The caller appends using
   * `appendComposerProposal` and never auto-sends.
   */
  onInsertProposal?: (proposal: ArtifactCanvasProposal) => void;
};

export function ArtifactCanvasPanel(props: ArtifactCanvasPanelProps): ReactElement {
  const { activeTarget } = props;
  const [pendingProposal, setPendingProposal] = useState<ArtifactCanvasProposal | null>(null);

  const plan = useMemo(() => {
    if (!activeTarget) return null;
    return materializeArtifact(activeTarget.intent, {
      mode: activeTarget.streaming === true ? 'stream-preview' : 'interactive',
      source: activeTarget.source,
      presentation: 'canvas',
      ...(props.artifactTheme ? { theme: props.artifactTheme } : {}),
    });
  }, [activeTarget, props.artifactTheme]);

  function handleInsert(): void {
    if (pendingProposal && props.onInsertProposal) {
      props.onInsertProposal(pendingProposal);
      // Keep Canvas open after insertion; clear only the accepted proposal so
      // the user can continue inspecting or revise selections.
      setPendingProposal(null);
    }
  }

  function handleDismiss(): void {
    setPendingProposal(null);
  }

  if (!activeTarget) {
    return (
      <div className="artifact-canvas-panel" data-testid="artifact-canvas-panel">
        <div className="artifact-canvas-empty muted" data-testid="artifact-canvas-empty">
          No Canvas artifact open. A new Canvas appears here automatically; use its conversation
          launcher to reopen it later.
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-canvas-panel" data-testid="artifact-canvas-panel">
      {pendingProposal ? (
        <div className="artifact-canvas-proposal" data-testid="artifact-canvas-proposal">
          <div className="artifact-canvas-proposal-head">
            <strong>{pendingProposal.label ?? 'Composer proposal'}</strong>
          </div>
          <pre
            className="artifact-canvas-proposal-text"
            data-testid="artifact-canvas-proposal-text"
          >
            {pendingProposal.text}
          </pre>
          <div className="artifact-canvas-proposal-actions">
            <Button
              variant="ghost"
              size="compact"
              data-testid="artifact-canvas-proposal-dismiss"
              onClick={handleDismiss}
            >
              Dismiss
            </Button>
            <Button
              size="compact"
              data-testid="artifact-canvas-proposal-insert"
              onClick={handleInsert}
            >
              Insert into Composer
            </Button>
          </div>
        </div>
      ) : null}
      {plan && (plan.kind === 'render' || plan.kind === 'blocked') ? (
        <ArtifactFrame
          key={`${props.artifactThemeKey ?? 'default'}:${activeTarget.id}`}
          plan={plan}
          presentation="canvas"
          initPriority={0}
          onComposerProposal={setPendingProposal}
        />
      ) : (
        <div className="artifact-canvas-empty muted">Preparing “{activeTarget.title}”…</div>
      )}
    </div>
  );
}
