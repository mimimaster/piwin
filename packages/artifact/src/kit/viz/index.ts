/**
 * Artifact viz kit (ADR 0093): step-through teaching figures, delivered as
 * its own script so documents that only use charts/icons never load it.
 * Served next to `kit.js` from the artifact scheme (same `/lib/v1/` CSP
 * source) or inlined in browser/e2e builds.
 */
import { ARTIFACT_VIZ_GRIDS } from './viz-grids.js';
import { ARTIFACT_VIZ_NETWORK } from './viz-network.js';
import { ARTIFACT_VIZ_BOOT, ARTIFACT_VIZ_HELPERS } from './viz-runtime.js';
import { ARTIFACT_VIZ_STRUCTURES } from './viz-structures.js';

export { ARTIFACT_VIZ_ICON_NAMES } from './viz-network.js';
export { buildArtifactVizCss } from './viz-css.js';

export const ARTIFACT_VIZ_VERSION_STRING = '1.0.0' as const;
/**
 * Versioned for the same reason as `ARTIFACT_KIT_V1_PATH`: the scheme serves
 * it as immutable. Keep in step with `crates/artifact-webview/src/protocol.rs`.
 */
export const ARTIFACT_VIZ_PATH = '/lib/v1/viz-1.0.0.js' as const;

const USES_VIZ = /data-piwin-viz\b/;

/** True when the source contains a viz figure. */
export function usesArtifactViz(source: string): boolean {
  return USES_VIZ.test(source);
}

/** The exact bytes of `viz.js` (served file and inline fallback). */
export function buildArtifactVizScript(): string {
  return `/* piwin artifact viz ${ARTIFACT_VIZ_VERSION_STRING} */
(function () {
'use strict';
if (window.__piwinViz) return;
window.__piwinViz = '${ARTIFACT_VIZ_VERSION_STRING}';
${ARTIFACT_VIZ_HELPERS}${ARTIFACT_VIZ_STRUCTURES}${ARTIFACT_VIZ_GRIDS}${ARTIFACT_VIZ_NETWORK}${ARTIFACT_VIZ_BOOT}
})();
`;
}
