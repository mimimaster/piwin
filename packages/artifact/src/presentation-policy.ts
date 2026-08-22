import { resolveArtifactRenderTarget } from './render-route.js';
import type { ArtifactDescriptor, ArtifactRenderMode } from './types.js';

export type ArtifactInlineCompatibilityIssue =
  'full-document' | 'viewport-unit' | 'viewport-height-script' | 'fixed-position';

export type ArtifactPresentationDecision =
  | { kind: 'source'; previewSurface: 'inline' | 'canvas' }
  | { kind: 'inline-static' }
  | { kind: 'inline-sandbox' }
  | { kind: 'inline-incompatible'; issues: ArtifactInlineCompatibilityIssue[] }
  | { kind: 'canvas' };

const VIEWPORT_UNIT_PATTERN = /(?:^|[^a-z0-9_-])(?:\d*\.?\d+)\s*(?:dvh|svh|lvh|vh)\b/i;
const VIEWPORT_HEIGHT_SCRIPT_PATTERN =
  /\b(?:window\s*\.\s*)?innerHeight\b|\bvisualViewport\s*\?*\.\s*height\b|\bdocument\s*\.\s*documentElement\s*\.\s*clientHeight\b/i;
const FIXED_POSITION_PATTERN = /\bposition\s*:\s*fixed\b/i;

/**
 * Inline is a content-sized component contract. A document or source coupled
 * to its own block viewport cannot have a stable parent-driven iframe height.
 * Detect and reject that contract mismatch instead of rewriting model CSS.
 */
export function findArtifactInlineCompatibilityIssues(
  descriptor: ArtifactDescriptor,
  source: string,
): ArtifactInlineCompatibilityIssue[] {
  const issues: ArtifactInlineCompatibilityIssue[] = [];
  if (descriptor.documentKind === 'document') issues.push('full-document');
  if (VIEWPORT_UNIT_PATTERN.test(source)) issues.push('viewport-unit');
  if (VIEWPORT_HEIGHT_SCRIPT_PATTERN.test(source)) issues.push('viewport-height-script');
  if (FIXED_POSITION_PATTERN.test(source)) issues.push('fixed-position');
  return issues;
}

/** One pure routing authority for code, Inline content, and Canvas documents. */
export function resolveArtifactPresentation(input: {
  descriptor: ArtifactDescriptor;
  mode: ArtifactRenderMode;
  source: string;
}): ArtifactPresentationDecision {
  const issues = findArtifactInlineCompatibilityIssues(input.descriptor, input.source);
  if (input.descriptor.declaration === 'native') {
    return {
      kind: 'source',
      previewSurface:
        input.descriptor.surface === 'canvas' || issues.length > 0 ? 'canvas' : 'inline',
    };
  }
  if (input.descriptor.surface === 'canvas') {
    return { kind: 'canvas' };
  }
  if (issues.length > 0) {
    return { kind: 'inline-incompatible', issues };
  }
  return resolveArtifactRenderTarget(input) === 'static-flow'
    ? { kind: 'inline-static' }
    : { kind: 'inline-sandbox' };
}
