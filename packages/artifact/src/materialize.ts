/**
 * One theme/srcdoc materialization path.
 * Stream sanitization and theme-contract repairs apply to `renderSource`
 * only. Copy/export must use `intent.descriptor.source`, never srcdoc.
 * Does not re-classify security or layout.
 */
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { buildStreamableArtifactPreview } from './streamable-preview.js';
import { createDefaultArtifactTheme } from './theme.js';
import { applyArtifactThemeContract } from './theme-contract.js';
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
    bodySource = buildStreamableArtifactPreview(bodySource).previewSource;
  }

  const contract = applyArtifactThemeContract(bodySource);
  if (contract.changed) {
    bodySource = contract.source;
  }

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
    documentKind: intent.descriptor.documentKind,
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
