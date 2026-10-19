/** @piwin/artifact — portable HTML artifact policy + srcdoc builder. */

export {
  STREAMING_ARTIFACT_FENCE_MARKER,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_FALLBACK_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_CONCURRENT_ARTIFACT_INITS,
  ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE,
  ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE,
  ARTIFACT_SELECTION_MAX_CHARS,
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
  ArtifactSelectionMessage,
  ArtifactSelectionRect,
  ComposerProposeTextActionPayload,
  ArtifactFrameMode,
  ArtifactCapabilityReport,
  ArtifactRenderIntent,
  ArtifactRenderPlan,
} from './types.js';

export { createDefaultArtifactIframePolicy } from './iframe-policy.js';

export { indexArtifactFences, createArtifactFenceRecord } from './fence-index.js';
export type { ArtifactFenceRecord, ArtifactTagBlockRange } from './fence-index.js';
export { canonicalizeArtifactTagBlocks } from './artifact-tag-canonicalize.js';
export { isProjectableStreamingFence } from './fence-syntax.js';

export { projectArtifactMarkdownForRender } from './markdown-projection.js';

export { createDefaultArtifactTheme, resolveArtifactOnAccent } from './theme.js';
export { resolveArtifactOnAccentForRules, resolveArtifactThemeCssVariables } from './srcdoc-css.js';
export { ARTIFACT_V14_TOKEN_NAMES, deriveArtifactV14Tokens } from './theme-tokens.js';
export type { ArtifactV14TokenName } from './theme-tokens.js';
export { resolveArtifactRules } from './artifact-rules.js';

export { buildArtifactReportKitCss } from './srcdoc-report-kit.js';
export { buildArtifactDiagramKitCss } from './srcdoc-diagram-kit.js';
export { buildArtifactComponentKitCss } from './srcdoc-component-kit.js';

export {
  parseArtifactBridgeMessage,
  parseArtifactActionMessage,
  normalizeArtifactLinkUrl,
  ARTIFACT_LINK_MAX_CHARS,
  parseArtifactErrorMessage,
  parseArtifactRenderSnapshot,
  parseArtifactScrollMessage,
  parseArtifactSelectionMessage,
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
  ARTIFACT_VIZ_ICON_NAMES,
  ARTIFACT_VIZ_PATH,
  ARTIFACT_VIZ_VERSION_STRING,
  artifactKitScriptSource,
  buildArtifactKitCss,
  buildArtifactKitHead,
  buildArtifactKitV1Script,
  buildArtifactVizCss,
  buildArtifactVizScript,
  configureArtifactKitDelivery,
  getArtifactKitDelivery,
  usesArtifactKit,
  usesArtifactViz,
} from './kit/index.js';
export type { ArtifactKitDelivery } from './kit/index.js';

export {
  artifactPaletteNeedsContrastProbe,
  artifactPaletteStyleAttribute,
  resolveArtifactPalette,
  usesArtifactReportKit,
} from './artifact-style.js';
export type { ArtifactPalette, ArtifactStyleModes, ResolveArtifactPaletteInput } from './artifact-style.js';
export { parseArtifactContrastMessage, parseArtifactLayoutMessage } from './bridge-protocol.js';
export { countShatteredText } from './layout-probe.js';
export { straightenLeftAccents } from './left-accent-straighten.js';
export {
  ARTIFACT_BRIDGE_CONTRAST_TYPE,
  ARTIFACT_BRIDGE_LAYOUT_TYPE,
  ARTIFACT_CONTRAST_FAILING_SHARE,
  ARTIFACT_CONTRAST_MAX_SAMPLES,
} from './constants.js';
export type { ArtifactContrastMessage, ArtifactLayoutMessage } from './types.js';
export { buildArtifactBridgeBootstrapScript } from './srcdoc-bridge.js';

export {
  EMOJI_ICON_CLASS,
  getEmojiIconGlyph,
  normalizeEmojiKey,
  resolveEmojiIcon,
  segmentEmojiText,
} from './emoji-icons/emoji-icon-text.js';
export {
  EMOJI_ICON_CSS,
  EMOJI_ICON_SKIP_TAGS,
  EMOJI_ICON_SVG_ATTRIBUTES,
  EMOJI_ICON_TEXT_CLASS,
  buildEmojiIconSrcdocHead,
  collectEmojiIcons,
  replaceEmojiIconsInTree,
} from './emoji-icons/emoji-icon-render.js';
export type { EmojiIconGlyphNode, EmojiTextSegment } from './emoji-icons/emoji-icon-types.js';
