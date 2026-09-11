import type { ReactElement } from 'react';

/**
 * Perimeter orbit beam overlay for the Inkstone composer slab.
 *
 * Renders an accessible, non-interactive decoration containing:
 * - A subtle static outer rail to preserve the slab silhouette;
 * - A masked perimeter track that constrains the moving light beam to a crisp 1.5px border;
 * - A traveling light beam animated smoothly via CSS motion-path (`offset-path: rect(...)`).
 *
 * Visibility and animations are driven entirely by CSS selectors on `.slab`
 * (e.g. `.is-streaming`, `.is-queued-edit`, or `.app-shell[data-state='running']`).
 */
export function ComposerOrbitBeam(): ReactElement {
  return (
    <div className="composer-orbit-overlay" aria-hidden="true">
      <div className="composer-orbit-rail" />
      <div className="composer-orbit-mask">
        <div className="composer-orbit-beam" />
      </div>
    </div>
  );
}
