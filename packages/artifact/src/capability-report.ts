/**
 * Observe Artifact source facts. Routing decisions live in render-intent.ts.
 */
import { DEFAULT_MAX_ARTIFACT_BYTES } from './constants.js';
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { classifyArtifactSecurity, type ArtifactSecurityPolicy } from './security.js';
import type { ArtifactCapabilityReport, ArtifactIframePolicy } from './types.js';

const SCRIPT_PATTERN =
  /<\s*script\b|\son[a-z][a-z0-9:_-]*\s*=|(?:java|vb)script\s*:|data\s*:\s*text\/html/i;
const EVENT_HANDLER_PATTERN = /\son[a-z][a-z0-9:_-]*\s*=/i;
const FORM_PATTERN = /<\s*form\b/i;
const IFRAME_PATTERN = /<\s*(?:iframe|frame|frameset|object|embed|portal)\b/i;
const ISOLATION_PATTERN = /<\s*(?:base|meta|link)\b/i;
const CSS_IMPORT_PATTERN = /@import\b/i;
const SHADOW_HOST_PATTERN = /:host(?:-context)?(?:\s|\()/i;
const RESOURCE_ATTRIBUTE_PATTERN =
  /\b(?:action|data|formaction|href|poster|src|srcset|xlink:href)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
const CSS_URL_PATTERN = /\burl\s*\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)/gi;
const SAFE_FRAGMENT_REFERENCE_PATTERN = /^#[A-Za-z_][\w:.-]*$/;
const SAFE_DATA_RESOURCE_PATTERN = /^data:(?:image|audio|video)\/[a-z0-9.+-]+[;,]/i;
const VIEWPORT_UNIT_PATTERN = /(?:^|[^a-z0-9_-])(?:\d*\.?\d+)\s*(?:dvh|svh|lvh|vh)\b/i;
const VIEWPORT_HEIGHT_SCRIPT_PATTERN =
  /\b(?:window\s*\.\s*)?innerHeight\b|\bvisualViewport\s*\?*\.\s*height\b|\bdocument\s*\.\s*documentElement\s*\.\s*clientHeight\b/i;
const CSS_RULE_PATTERN = /[^{}]+\{[^{}]*\}/g;
const STYLE_ATTRIBUTE_PATTERN = /\bstyle\s*=\s*(["'])(.*?)\1/gi;

function isInlineResourceReference(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    SAFE_FRAGMENT_REFERENCE_PATTERN.test(normalized) ||
    SAFE_DATA_RESOURCE_PATTERN.test(normalized)
  );
}

function collectNonInlineReferences(
  source: string,
  pattern: RegExp,
): string[] {
  const values: string[] = [];
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const value = match[2] ?? match[3] ?? '';
    if (!isInlineResourceReference(value)) {
      values.push(value);
    }
  }
  return values;
}

function isFourEdgeFixedDeclaration(block: string): boolean {
  if (!/\bposition\s*:\s*fixed\b/i.test(block)) {
    return false;
  }
  if (/\binset\s*:\s*0(?:px)?(?:\s+0(?:px)?){0,3}\b/i.test(block)) {
    return true;
  }
  return (
    /\btop\s*:\s*0(?:px)?\b/i.test(block) &&
    /\bright\s*:\s*0(?:px)?\b/i.test(block) &&
    /\bbottom\s*:\s*0(?:px)?\b/i.test(block) &&
    /\bleft\s*:\s*0(?:px)?\b/i.test(block)
  );
}

function hasFourEdgeFixedShell(source: string): boolean {
  const rules = source.match(CSS_RULE_PATTERN) ?? [];
  if (rules.some((rule) => isFourEdgeFixedDeclaration(rule))) {
    return true;
  }
  STYLE_ATTRIBUTE_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(STYLE_ATTRIBUTE_PATTERN)) {
    if (isFourEdgeFixedDeclaration(match[2] ?? '')) {
      return true;
    }
  }
  return false;
}

export function inspectArtifactCapabilities(
  source: string,
  iframePolicy?: ArtifactIframePolicy,
  maxBytes?: number,
  policy?: ArtifactSecurityPolicy,
): ArtifactCapabilityReport {
  const security = classifyArtifactSecurity(
    source,
    iframePolicy ?? createDefaultArtifactIframePolicy(),
    maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
    policy ?? {},
  );

  const attributeRefs = collectNonInlineReferences(source, RESOURCE_ATTRIBUTE_PATTERN);
  const cssUrlRefs = collectNonInlineReferences(source, CSS_URL_PATTERN);
  const cssImport = CSS_IMPORT_PATTERN.test(source);

  return {
    scripts: SCRIPT_PATTERN.test(source),
    events: EVENT_HANDLER_PATTERN.test(source),
    form: FORM_PATTERN.test(source),
    iframe: IFRAME_PATTERN.test(source),
    externalUrl: attributeRefs.length > 0,
    cssUrl: cssUrlRefs.length > 0 || cssImport,
    shadowHost: SHADOW_HOST_PATTERN.test(source),
    viewportDependency:
      VIEWPORT_UNIT_PATTERN.test(source) ||
      VIEWPORT_HEIGHT_SCRIPT_PATTERN.test(source) ||
      hasFourEdgeFixedShell(source),
    isolation: ISOLATION_PATTERN.test(source),
    blockReason: security.blockReason,
    byteSize: security.byteSize,
    externalResources: security.externalResources,
  };
}

export function capabilitiesNeedSandbox(capabilities: ArtifactCapabilityReport): boolean {
  return (
    capabilities.scripts ||
    capabilities.events ||
    capabilities.form ||
    capabilities.iframe ||
    capabilities.externalUrl ||
    capabilities.cssUrl ||
    capabilities.shadowHost ||
    capabilities.isolation
  );
}
