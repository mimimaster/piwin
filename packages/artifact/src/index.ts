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
  ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_ERROR_TYPE,
  ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE,
  ARTIFACT_BRIDGE_RETIRE_TYPE,
  COMPOSER_PROPOSE_TEXT_ACTION,
} from './constants.js';

export type {
  ArtifactRenderMode,
  ArtifactDescriptor,
  ArtifactDeclaration,
  ArtifactDocumentKind,
  ArtifactRules,
  ArtifactStyle,
  ArtifactThemeVariables,
  ArtifactActionMessage,
  ArtifactErrorMessage,
  ArtifactScrollMessage,
  ComposerProposeTextActionPayload,
  ArtifactFrameMode,
  ArtifactCapabilityReport,
  ArtifactRenderIntent,
  ArtifactRenderPlan,
} from './types.js';

export { createDefaultArtifactIframePolicy } from './iframe-policy.js';

export { indexArtifactFences, createArtifactFenceRecord } from './fence-index.js';
export type { ArtifactFenceRecord } from './fence-index.js';
export { isProjectableStreamingFence } from './fence-syntax.js';

export { projectArtifactMarkdownForRender } from './markdown-projection.js';

export { createDefaultArtifactTheme, resolveArtifactOnAccent } from './theme.js';
export { resolveArtifactOnAccentForRules, resolveArtifactThemeCssVariables } from './srcdoc-css.js';
export { ARTIFACT_V14_TOKEN_NAMES, deriveArtifactV14Tokens } from './theme-tokens.js';
export type { ArtifactV14TokenName } from './theme-tokens.js';
export { resolveArtifactRules } from './artifact-rules.js';

export { buildArtifactReportKitCss } from './srcdoc-report-kit.js';

export {
  parseArtifactBridgeMessage,
  parseArtifactActionMessage,
  parseArtifactErrorMessage,
  parseArtifactRenderSnapshot,
  parseArtifactScrollMessage,
  readArtifactPostSeq,
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
export {
  bindArtifactSessionMedia,
  listArtifactSessionMediaIds,
  isBindableArtifactMediaId,
} from './bind-session-media.js';

export {
  buildStableArtifactRevealFrames,
  buildStreamableArtifactPreview,
  projectHtmlSourceForStreamRoot,
} from './streamable-preview.js';

export {
  ARTIFACT_KIT_CHART_KINDS,
  ARTIFACT_KIT_MAJOR,
  ARTIFACT_KIT_V1_ICON_NAMES,
  ARTIFACT_KIT_V1_PATH,
  ARTIFACT_KIT_VERSION_STRING,
  artifactKitScriptSource,
  buildArtifactKitCss,
  buildArtifactKitHead,
  buildArtifactKitV1Script,
  configureArtifactKitDelivery,
  getArtifactKitDelivery,
  usesArtifactKit,
} from './kit/index.js';
export type { ArtifactKitDelivery } from './kit/index.js';
