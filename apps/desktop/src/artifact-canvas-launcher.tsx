/**
 * Transcript launcher for `surface="canvas"` artifact fences.
 *
 * Renders a compact card in the transcript instead of mounting an inline
 * ArtifactFrame. The user clicks "Open Canvas" to route the fence into the
 * right-side Canvas shell (ADR 0029). Streaming Canvas fences stay
 * source-only in the transcript; the panel stream-previews via auto-reveal.
 */

import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

function CopySourceButton(props: { text: string }): ReactElement {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      size="compact"
      data-testid="artifact-canvas-copy-source"
      onClick={() => {
        void (async () => {
          try {
            if (!navigator.clipboard?.writeText) {
              throw new Error('Clipboard unavailable');
            }
            await navigator.clipboard.writeText(props.text);
            setStatus('copied');
            window.setTimeout(() => setStatus('idle'), 1500);
          } catch {
            setStatus('failed');
            window.setTimeout(() => setStatus('idle'), 2000);
          }
        })();
      }}
    >
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  );
}

export type ArtifactCanvasLauncherProps = {
  title: string;
  /** Raw model source for the optional source disclosure and copy action. */
  source: string;
  /** Raw fence language label (e.g. `artifact-html`). */
  rawLanguage: string;
  /** Open the Canvas shell with this fence as the active target. */
  onOpenCanvas: () => void;
};

export function ArtifactCanvasLauncher(props: ArtifactCanvasLauncherProps): ReactElement {
  const [sourceOpen, setSourceOpen] = useState(false);
  return (
    <div className="artifact-canvas-launcher" data-testid="artifact-canvas-launcher">
      <div className="artifact-canvas-launcher-head">
        <div className="artifact-canvas-launcher-title">
          <strong>{props.title}</strong>
          <span className="pill">canvas</span>
        </div>
        <div className="artifact-canvas-launcher-actions">
          <CopySourceButton text={props.source} />
          <Button size="compact" data-testid="artifact-canvas-open" onClick={props.onOpenCanvas}>
            Open Canvas
          </Button>
        </div>
      </div>
      <p className="muted artifact-canvas-launcher-intent">
        Interactive workspace — opens in the right panel.
      </p>
      <details
        className="artifact-canvas-launcher-source"
        open={sourceOpen}
        onToggle={(event) => setSourceOpen(event.currentTarget.open)}
      >
        <summary>{props.rawLanguage || 'html'} source</summary>
        <pre className="md-code">
          <code>{props.source}</code>
        </pre>
      </details>
    </div>
  );
}
