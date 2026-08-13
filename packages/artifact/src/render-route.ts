import type { ArtifactDescriptor, ArtifactRenderMode } from './types.js';

export type ArtifactRenderTarget = 'static-flow' | 'sandbox';

export type ResolveArtifactRenderTargetInput = {
  descriptor: ArtifactDescriptor;
  mode: ArtifactRenderMode;
  /** Repaired source that will actually be displayed. */
  source: string;
};

const JAVASCRIPT_CAPABILITY_PATTERN =
  /<\s*script\b|\son[a-z][a-z0-9:_-]*\s*=|(?:java|vb)script\s*:|data\s*:\s*text\/html/i;
const ISOLATED_BROWSER_CAPABILITY_PATTERN =
  /<\s*(?:iframe|frame|frameset|object|embed|portal|form|base|meta|link)\b/i;
const CSS_IMPORT_PATTERN = /@import\b/i;
const SHADOW_HOST_SELECTOR_PATTERN = /:host(?:-context)?(?:\s|\()/i;
const RESOURCE_ATTRIBUTE_PATTERN =
  /\b(?:action|data|formaction|href|poster|src|srcset|xlink:href)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
const CSS_URL_PATTERN = /\burl\s*\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)/gi;
const SAFE_FRAGMENT_REFERENCE_PATTERN = /^#[A-Za-z_][\w:.-]*$/;
const SAFE_DATA_RESOURCE_PATTERN = /^data:(?:image|audio|video)\/[a-z0-9.+-]+[;,]/i;

function isInlineResourceReference(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    SAFE_FRAGMENT_REFERENCE_PATTERN.test(normalized) ||
    SAFE_DATA_RESOURCE_PATTERN.test(normalized)
  );
}

function hasExternalResourceReference(source: string): boolean {
  RESOURCE_ATTRIBUTE_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(RESOURCE_ATTRIBUTE_PATTERN)) {
    const value = match[2] ?? match[3] ?? '';
    if (!isInlineResourceReference(value)) return true;
  }
  CSS_URL_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(CSS_URL_PATTERN)) {
    const value = match[2] ?? match[3] ?? '';
    if (!isInlineResourceReference(value)) return true;
  }
  return CSS_IMPORT_PATTERN.test(source);
}

/**
 * Select the smallest safe renderer for a completed Artifact.
 *
 * Static content is sanitized again by Desktop before entering a Shadow DOM.
 * This pure classifier deliberately routes any executable, navigational,
 * embedded, externally-referenced, or Shadow-host-aware source to the sandbox.
 */
export function resolveArtifactRenderTarget(
  input: ResolveArtifactRenderTargetInput,
): ArtifactRenderTarget {
  if (
    input.mode !== 'interactive' ||
    input.descriptor.surface !== 'inline' ||
    JAVASCRIPT_CAPABILITY_PATTERN.test(input.source) ||
    ISOLATED_BROWSER_CAPABILITY_PATTERN.test(input.source) ||
    hasExternalResourceReference(input.source) ||
    SHADOW_HOST_SELECTOR_PATTERN.test(input.source)
  ) {
    return 'sandbox';
  }
  return 'static-flow';
}
