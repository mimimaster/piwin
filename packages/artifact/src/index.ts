/** @piwin/artifact — portable HTML artifact policy + srcdoc builder. */

export {
  ARTIFACT_LANGUAGE_ALIASES,
  AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  DEFAULT_MAX_ARTIFACT_BYTES,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_FALLBACK_HEIGHT,
  ARTIFACT_VIEWPORT_FILL_HEIGHT,
  ARTIFACT_VIEWPORT_FILL_SLACK_PX,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_CONCURRENT_ARTIFACT_INITS,
  ARTIFACT_LIVE_PRIORITY_VISIBLE,
  ARTIFACT_LIVE_PRIORITY_STREAM,
  ARTIFACT_LIVE_PRIORITY_CANVAS,
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  COMPOSER_PROPOSE_TEXT_ACTION,
  ARTIFACT_ACTION_NAMES,
  DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES,
} from './constants.js';

export type {
  ArtifactStatus,
  ArtifactRenderPhase,
  ArtifactRenderMode,
  ArtifactSecurityBlockReason,
  ExternalArtifactResourceKind,
  ExternalArtifactResource,
  ArtifactSecurityResult,
  ArtifactSurface,
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
  ArtifactLayoutContractIssueKind,
  ArtifactLayoutContractRepair,
  StreamablePreviewResult,
  OpenArtifactFence,
  ArtifactBridgeMessageType,
  ArtifactBridgeMessage,
  ArtifactActionName,
  ArtifactActionMessage,
  FlashcardRateActionPayload,
  FlashcardOpenSourceActionPayload,
  ComposerProposeTextActionPayload,
  ArtifactPreviewDecision,
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

export { tryParseHtmlArtifactFence, splitMarkdownBlocks } from './parser.js';
export type { MarkdownFenceBlock, ParsedMarkdownBlock, TableAlignment } from './parser.js';

export {
  isFullHtmlDocument,
  normalizeHtmlDocumentToArtifactFragment,
} from './html-document-fragment.js';

export { createDefaultArtifactTheme } from './theme.js';

export {
  buildStrictArtifactCsp,
  buildHtmlArtifactSrcdoc,
  buildArtifactBridgeBootstrapScript,
} from './srcdoc.js';
export type { BuildHtmlArtifactSrcdocInput } from './srcdoc.js';

export {
  parseArtifactBridgeMessage,
  isArtifactBridgeReadyMessage,
  parseArtifactActionMessage,
} from './bridge-protocol.js';

export {
  normalizeArtifactHeight,
  clampArtifactHeight,
  stabilizeInlineArtifactHeight,
} from './height-policy.js';
export type { StabilizeInlineArtifactHeightInput } from './height-policy.js';

export { resolveArtifactRenderTarget } from './render-route.js';
export type {
  ArtifactRenderTarget,
  ResolveArtifactRenderTargetInput,
} from './render-route.js';

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

export {
  findOpenArtifactFence,
  findOpenAmbiguousArtifactFence,
  normalizeAmbiguousArtifactFences,
  normalizeArtifactTagBlocks,
  normalizeStreamingArtifactFences,
} from './streaming.js';

export { buildStreamableArtifactPreview } from './streamable-preview.js';

export { applyArtifactThemeContract } from './theme-contract.js';

export { applyArtifactLayoutContract } from './layout-contract.js';
export type { ArtifactLayoutContractResult } from './layout-contract.js';

export {
  evaluateCodeFence,
  evaluateArtifactDescriptor,
  evaluateHtmlArtifactDescriptor,
} from './evaluate.js';
export type { EvaluateCodeFenceOptions, EvaluateDescriptorOptions } from './evaluate.js';
