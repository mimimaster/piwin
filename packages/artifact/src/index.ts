/** @piwin/artifact — portable HTML artifact policy + srcdoc builder. */

export {
  STREAMING_ARTIFACT_FENCE_MARKER,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_FALLBACK_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_CONCURRENT_ARTIFACT_INITS,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  COMPOSER_PROPOSE_TEXT_ACTION,
} from './constants.js';

export type {
  ArtifactRenderMode,
  ArtifactDescriptor,
  ArtifactDeclaration,
  ArtifactDocumentKind,
  ArtifactThemeVariables,
  ArtifactActionMessage,
  ComposerProposeTextActionPayload,
  ArtifactFrameMode,
  ArtifactCapabilityReport,
  ArtifactRenderIntent,
  ArtifactRenderPlan,
} from './types.js';

export { createDefaultArtifactIframePolicy } from './iframe-policy.js';

export { indexArtifactFences, createArtifactFenceRecord } from './fence-index.js';
export type { ArtifactFenceRecord } from './fence-index.js';

export { projectArtifactMarkdownForRender } from './markdown-projection.js';

export { createDefaultArtifactTheme } from './theme.js';

export {
  parseArtifactBridgeMessage,
  parseArtifactActionMessage,
  parseArtifactRenderSnapshot,
} from './bridge-protocol.js';

export { advanceArtifactFrameMode } from './frame-mode.js';

export {
  clampArtifactHeight,
  resolveArtifactViewportFrameHeight,
  shouldEnterArtifactInlineOverflow,
} from './height-policy.js';

export { estimateSvgFenceHeight } from './svg-intrinsic-size.js';

export { analyzeArtifactFence } from './render-intent.js';

export { materializeArtifact } from './materialize.js';
