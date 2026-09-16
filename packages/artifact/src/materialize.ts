/**
 * One theme/srcdoc materialization path.
 * Stream sanitization and theme-contract repairs apply to `renderSource`
 * only. Copy/export must use `intent.descriptor.source`, never srcdoc.
 * Does not re-classify security or layout.
 */
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import {
  buildStreamableArtifactPreview,
  projectHtmlSourceForStreamRoot,
} from './streamable-preview.js';
import { createDefaultArtifactTheme } from './theme.js';
import { applyArtifactThemeContract } from './theme-contract.js';
import { bindArtifactSessionMedia } from './bind-session-media.js';
import type {
  ArtifactFrameMode,
  ArtifactIframePolicy,
  ArtifactRenderIntent,
  ArtifactRenderMode,
  ArtifactRenderPlan,
  ArtifactSurface,
  ArtifactThemeVariables,
} from './types.js';

export type MaterializeArtifactOptions = {
  theme?: ArtifactThemeVariables;
  mode: ArtifactRenderMode;
  source?: string;
  iframePolicy?: ArtifactIframePolicy;
  /**
   * Host chrome that will display the document. Defaults from `intent.surface`.
   * Canvas hosts pass `'canvas'` so srcdoc overflow is a panel scrollport
   * without rewriting the stored intent.
   */
  presentation?: ArtifactSurface;
  /**
   * Session-vault images keyed by mediaId, as self-contained `data:` URLs.
   * A `blob:` URL cannot be read from the sandbox's opaque origin, so only
   * `data:` values are written into render HTML. Descriptor source is never
   * rewritten.
   */
  mediaDataUrls?: ReadonlyMap<string, string>;
};

function frameModeFor(
  intent: ArtifactRenderIntent,
  presentation: ArtifactSurface,
): ArtifactFrameMode {
  if (presentation === 'canvas') {
    return 'canvas';
  }
  if (intent.layout === 'viewport') {
    return 'inline-viewport';
  }
  return 'inline-flow';
}

export function materializeArtifact(
  intent: ArtifactRenderIntent,
  options: MaterializeArtifactOptions,
): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const mode = options.mode;
  const presentation: ArtifactSurface = options.presentation ?? intent.surface;
  let bodySource = options.source ?? intent.descriptor.source;

  if (mode === 'stream-preview') {
    const streamPreview = buildStreamableArtifactPreview(bodySource);
    // `previewSource` is diagnostic when no stable visual boundary exists.
    // Do not leak that unstable prefix into the iframe; keep the mounted stream
    // document empty until the first safe snapshot can be reconciled in place.
    bodySource = streamPreview.canStream ? streamPreview.previewSource : '';
  }

  // Stream updates sync into `.piwin-artifact-root`. Full documents have no such
  // root when hosted as documentKind=document, so stream-preview always uses the
  // fragment shell and flattens doctype/html/head/body into that root.
  const streamFragmentShell = mode === 'stream-preview';
  if (streamFragmentShell && bodySource && intent.descriptor.documentKind === 'document') {
    bodySource = projectHtmlSourceForStreamRoot(bodySource);
  }

  const contract = applyArtifactThemeContract(bodySource);
  if (contract.changed) {
    bodySource = contract.source;
  }
  bodySource = bindArtifactSessionMedia(bodySource, options.mediaDataUrls ?? new Map());

  const frameMode = frameModeFor(intent, presentation);
  const useStatic =
    intent.renderer === 'static' && mode === 'interactive' && presentation !== 'canvas';
  if (useStatic) {
    return {
      kind: 'render',
      intent,
      frameMode,
      mode,
      renderSource: bodySource,
      document: { kind: 'static-source', source: bodySource },
    };
  }

  const theme = options.theme ?? createDefaultArtifactTheme('dark');
  const iframePolicy = options.iframePolicy ?? createDefaultArtifactIframePolicy('allowlist');
  const { srcdoc, csp } = buildHtmlArtifactSrcdoc({
    source: bodySource,
    channelId: intent.descriptor.id,
    theme,
    iframePolicy,
    surface: presentation,
    frameMode,
    includeBridge: true,
    enableStreamUpdates: true,
    freezeSource: mode !== 'stream-preview',
    documentKind: streamFragmentShell ? 'fragment' : intent.descriptor.documentKind,
  });

  return {
    kind: 'render',
    intent,
    frameMode,
    mode,
    renderSource: bodySource,
    document: { kind: 'sandbox', srcdoc, csp },
  };
}
