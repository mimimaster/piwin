/**
 * High-level artifact pipeline used by chat UI:
 * fence → descriptor → (theme soft-repair) → security → srcdoc (or blocked).
 */
import { DEFAULT_MAX_ARTIFACT_BYTES } from './constants.js';
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { applyArtifactLayoutContract } from './layout-contract.js';
import { tryParseHtmlArtifactFence } from './parser.js';
import { classifyArtifactSecurity } from './security.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { buildStreamableArtifactPreview } from './streamable-preview.js';
import { createDefaultArtifactTheme } from './theme.js';
import { applyArtifactThemeContract } from './theme-contract.js';
import type {
  ArtifactIframePolicy,
  ArtifactPreviewDecision,
  ArtifactRenderMode,
  ArtifactThemeContractRepair,
  ArtifactThemeVariables,
  ArtifactDescriptor,
  ArtifactSurface,
} from './types.js';

export type EvaluateCodeFenceOptions = {
  language: string;
  source: string;
  id?: string;
  htmlUiModeEnabled?: boolean;
  maxBytes?: number;
  iframePolicy?: ArtifactIframePolicy;
  theme?: ArtifactThemeVariables;
  mode?: ArtifactRenderMode;
  /** Soft-repair light surfaces for preview. Default true. */
  applyThemeContract?: boolean;
};

/**
 * Evaluate a single markdown code fence for artifact rendering.
 * Non-artifact fences return `{ kind: 'code' }`.
 */
export function evaluateCodeFence(options: EvaluateCodeFenceOptions): ArtifactPreviewDecision {
  const parseInput: {
    language: string;
    source: string;
    id: string;
    htmlUiModeEnabled?: boolean;
    allowIncompleteSource?: boolean;
  } = {
    language: options.language,
    source: options.source,
    id: options.id ?? `artifact-${hashSeed(options.language, options.source)}`,
  };
  if (options.htmlUiModeEnabled !== undefined) {
    parseInput.htmlUiModeEnabled = options.htmlUiModeEnabled;
  }
  if (options.mode === 'stream-preview') {
    parseInput.allowIncompleteSource = true;
  }

  const descriptor = tryParseHtmlArtifactFence(parseInput);
  if (!descriptor) {
    return {
      kind: 'code',
      language: options.language,
      source: options.source,
    };
  }

  const evaluateOptions: EvaluateDescriptorOptions = {
    mode: options.mode ?? 'interactive',
  };
  if (options.maxBytes !== undefined) {
    evaluateOptions.maxBytes = options.maxBytes;
  }
  if (options.iframePolicy) {
    evaluateOptions.iframePolicy = options.iframePolicy;
  }
  if (options.theme) {
    evaluateOptions.theme = options.theme;
  }
  if (options.applyThemeContract !== undefined) {
    evaluateOptions.applyThemeContract = options.applyThemeContract;
  }
  return evaluateArtifactDescriptor(descriptor, evaluateOptions);
}

export type EvaluateDescriptorOptions = {
  maxBytes?: number;
  iframePolicy?: ArtifactIframePolicy;
  theme?: ArtifactThemeVariables;
  mode?: ArtifactRenderMode;
  applyThemeContract?: boolean;
  /**
   * Optional body used for srcdoc only (streamable preview).
   * Security still classifies descriptor.source.
   */
  renderSource?: string;
  /** Surface the artifact will be rendered on (affects CSP/bridge). */
  renderSurface?: ArtifactSurface;
};

export function evaluateArtifactDescriptor(
  descriptor: ArtifactDescriptor,
  options: EvaluateDescriptorOptions = {},
): ArtifactPreviewDecision {
  const iframePolicy = options.iframePolicy ?? createDefaultArtifactIframePolicy('allowlist');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  const mode: ArtifactRenderMode = options.mode ?? 'interactive';
  const applyTheme = options.applyThemeContract !== false;

  // Security always on original model source.
  const security = classifyArtifactSecurity(descriptor.source, iframePolicy, maxBytes);

  if (!security.canRender) {
    const reason = security.blockReason ?? 'blocked-empty';
    // While the model is still streaming, an empty/placeholder source is not a
    // block — it just means tokens have not arrived yet. Mount the frame
    // immediately (empty body) and let stream snapshots draw the UI block by
    // block. Real blocks (size, external resources) stay blocked.
    if (mode !== 'stream-preview' || reason !== 'blocked-empty') {
      return {
        kind: 'blocked',
        descriptor,
        security,
        reason,
      };
    }
  }

  let bodySource = options.renderSource ?? descriptor.source;

  if (mode === 'stream-preview') {
    const preview = buildStreamableArtifactPreview(bodySource);
    // previewSource is the sanitized source even when there is no stable
    // structure yet. Bootstrapping with it keeps one live iframe through the
    // whole stream — the first safe snapshot appears progressively instead of
    // a waiting state, and incomplete markup is auto-closed by the parser.
    bodySource = preview.previewSource;
  }

  let themeRepairs: ArtifactThemeContractRepair[] = [];
  if (applyTheme) {
    const contract = applyArtifactThemeContract(bodySource);
    if (contract.changed) {
      bodySource = contract.source;
      themeRepairs = contract.repairs;
    }
  }

  // Neutralize viewport-unit heights (100vh feedback loop) before measuring.
  const layout = applyArtifactLayoutContract(bodySource);
  if (layout.changed) {
    bodySource = layout.source;
  }

  const theme = options.theme ?? createDefaultArtifactTheme('dark');
  const renderSurface = options.renderSurface ?? descriptor.surface;
  // One channel spans stream-preview and final commit. Changing it at `done`
  // tears down the Desktop iframe init lifecycle and creates a white frame.
  const channelId = descriptor.id;
  const { srcdoc, csp } = buildHtmlArtifactSrcdoc({
    source: bodySource,
    channelId,
    theme,
    iframePolicy,
    surface: renderSurface,
    includeBridge: true,
    enableStreamUpdates: mode === 'stream-preview',
  });

  return {
    kind: 'render',
    mode,
    descriptor,
    security,
    srcdoc,
    csp,
    renderSource: bodySource,
    ...(mode === 'stream-preview' ? { streamSource: bodySource } : {}),
    themeRepairs,
    layoutRepairs: layout.repairs,
  };
}

export function evaluateHtmlArtifactDescriptor(
  descriptor: ArtifactDescriptor,
  options: EvaluateDescriptorOptions = {},
): ArtifactPreviewDecision {
  return evaluateArtifactDescriptor(descriptor, options);
}

function hashSeed(language: string, source: string): string {
  let hash = 0;
  const input = `${language}\n${source}`;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
