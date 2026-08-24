/** @piwin/artifact — portable HTML artifact policy + srcdoc builder. */

export {
  ARTIFACT_LANGUAGE_ALIASES,
  CANONICAL_ARTIFACT_LANGUAGE,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  STREAMING_ARTIFACT_FENCE_MARKER,
  DEFAULT_MAX_ARTIFACT_BYTES,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_FALLBACK_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_CONCURRENT_ARTIFACT_INITS,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_BRIDGE_SIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  COMPOSER_PROPOSE_TEXT_ACTION,
  ARTIFACT_ACTION_NAMES,
  DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES,
} from './constants.js';

export type {
  ArtifactRenderMode,
  ArtifactSecurityBlockReason,
  ExternalArtifactResourceKind,
  ExternalArtifactResource,
  ArtifactSecurityResult,
  ArtifactSurface,
  ArtifactDeclaration,
  ArtifactDocumentKind,
  ArtifactDescriptorBase,
  HtmlArtifactDescriptor,
  SvgArtifactDescriptor,
  ArtifactDescriptor,
  ArtifactIframePolicyMode,
  ArtifactIframePolicy,
  ArtifactThemeVariables,
  ArtifactThemeContractIssueKind,
  ArtifactThemeContractIssue,
  ArtifactThemeContractRepair,
  ArtifactThemeContractResult,
  StreamablePreviewResult,
  ArtifactBridgeMessageType,
  ArtifactBridgeMessage,
  ArtifactActionName,
  ArtifactActionMessage,
  FlashcardRateActionPayload,
  FlashcardOpenSourceActionPayload,
  ComposerProposeTextActionPayload,
  ArtifactDownloadUnsupportedPayload,
  ArtifactLayoutIntent,
  ArtifactFrameMode,
  ArtifactCapabilityReport,
  ArtifactRenderIntent,
  ArtifactRenderPlan,
  ArtifactFenceAnalysis,
} from './types.js';

export {
  createDefaultArtifactIframePolicy,
  sanitizeArtifactIframeAllowlist,
  normalizeArtifactIframeUrl,
  isHttpArtifactIframeUrl,
  isAllowedArtifactIframeUrl,
  buildArtifactFrameSrcCsp,
} from './iframe-policy.js';

export {
  isPlaceholderArtifactSource,
  getUtf8ByteSize,
  detectExternalArtifactResources,
  classifyArtifactSecurity,
} from './security.js';

export { parseArtifactFenceRecord } from './parser.js';
export type { ParseArtifactFenceInput } from './parser.js';

export { indexArtifactFences, createArtifactFenceRecord } from './fence-index.js';
export type { ArtifactFenceRecord } from './fence-index.js';

export { projectArtifactMarkdownForRender } from './markdown-projection.js';
export type { ArtifactMarkdownProjection } from './markdown-projection.js';

export { isFullHtmlDocument } from './html-document.js';

export { createDefaultArtifactTheme } from './theme.js';

export {
  buildStrictArtifactCsp,
  buildHtmlArtifactSrcdoc,
  buildArtifactBridgeBootstrapScript,
} from './srcdoc.js';
export type { BuildHtmlArtifactSrcdocInput } from './srcdoc.js';

export { parseArtifactBridgeMessage, parseArtifactActionMessage } from './bridge-protocol.js';

export { normalizeArtifactHeight, clampArtifactHeight } from './height-policy.js';

export { parseSvgFenceIntrinsicSize, estimateSvgFenceHeight } from './svg-intrinsic-size.js';
export type { EstimateSvgFenceHeightInput } from './svg-intrinsic-size.js';

export {
  requestArtifactInit,
  cancelArtifactInit,
  releaseArtifactInit,
  getActiveArtifactInitCount,
  getQueuedArtifactInitCount,
  resetArtifactInitQueueForTests,
} from './init-queue.js';

export {
  MAX_LIVE_ARTIFACT_IFRAMES,
  claimArtifactLiveHost,
  requestArtifactLiveHost,
  evictNonForceKeepArtifactHosts,
  releaseArtifactLiveHost,
  getLiveArtifactHostCount,
  getWaitingArtifactHostCount,
  getLiveArtifactHostIdsForTests,
  getWaitingArtifactHostIdsForTests,
  resetArtifactLiveHostRegistryForTests,
} from './live-host-registry.js';
export type { ArtifactLiveHostRegistration } from './live-host-registry.js';

export { buildStreamableArtifactPreview } from './streamable-preview.js';

export { applyArtifactThemeContract } from './theme-contract.js';

export { analyzeArtifactFence } from './render-intent.js';
export type { AnalyzeArtifactFenceOptions } from './render-intent.js';

export { materializeArtifact } from './materialize.js';
export type { MaterializeArtifactOptions } from './materialize.js';
