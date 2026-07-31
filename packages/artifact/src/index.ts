/** @piwin/artifact — portable HTML artifact policy + srcdoc builder. */

export {
  ARTIFACT_LANGUAGE_ALIASES,
  AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  DEFAULT_MAX_ARTIFACT_BYTES,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  INITIAL_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_EXPANDED_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_CONCURRENT_ARTIFACT_INITS,
  ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS,
  ARTIFACT_FINAL_TRIM_SETTLE_MS,
  ARTIFACT_HEIGHT_MEASURE_LADDER_MS,
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_ACTION_NAMES,
  DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES,
} from './constants.js';

export type {
  ArtifactStatus,
  ArtifactRenderPhase,
  ArtifactRenderMode,
  ArtifactHeightPhase,
  ArtifactHeightMeasurementMode,
  ArtifactSecurityBlockReason,
  ExternalArtifactResourceKind,
  ExternalArtifactResource,
  ArtifactSecurityResult,
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
export type { MarkdownFenceBlock, ParsedMarkdownBlock } from './parser.js';

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
  resolveImmediateArtifactHeight,
  resolveInteractiveArtifactShrink,
} from './height-policy.js';
export type {
  ResolveImmediateArtifactHeightInput,
  ResolveInteractiveArtifactShrinkInput,
  ResolveInteractiveArtifactShrinkResult,
} from './height-policy.js';

export {
  requestArtifactInit,
  cancelArtifactInit,
  releaseArtifactInit,
  getActiveArtifactInitCount,
  getQueuedArtifactInitCount,
  resetArtifactInitQueueForTests,
} from './init-queue.js';

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
