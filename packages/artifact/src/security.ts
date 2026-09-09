/**
 * Artifact security classifier.
 * Ported from openwebui_m artifactSecurity.ts — pure policy, no host I/O.
 */
import { DEFAULT_MAX_ARTIFACT_BYTES } from './constants.js';
import {
  isAllowedArtifactIframeUrl,
  createDefaultArtifactIframePolicy,
} from './iframe-policy.js';
import type {
  ArtifactIframePolicy,
  ArtifactSecurityResult,
  ExternalArtifactResource,
  ExternalArtifactResourceKind,
} from './types.js';

const EXTERNAL_RESOURCE_PATTERNS: Array<{
  kind: ExternalArtifactResourceKind;
  pattern: RegExp;
}> = [
  { kind: 'link', pattern: /<link\b[^>]*\bhref\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi },
  { kind: 'script', pattern: /<script\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi },
  { kind: 'image', pattern: /<img\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi },
  {
    kind: 'image',
    pattern:
      /<(?:image|use)\b[^>]*\b(?:href|xlink:href|src)\s*=\s*(['"])(https?:\/\/[^'"]+)\1/gi,
  },
  {
    kind: 'iframe',
    pattern:
      /<iframe\b[^>]*\bsrc\s*=\s*(?:(['"])(https?:\/\/[^'">\s]+|\/\/[^'">\s]+)\1|(https?:\/\/[^\s>]+|\/\/[^\s>]+))/gi,
  },
  {
    kind: 'object',
    pattern: /<object\b[^>]*\b(?:data|src)\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi,
  },
  {
    kind: 'media',
    pattern: /<(?:audio|video|source)\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi,
  },
];

function htmlTagHasSessionMediaBind(source: string, matchIndex: number): boolean {
  const tagStart = source.lastIndexOf('<', matchIndex);
  if (tagStart < 0) {
    return false;
  }
  const tagEnd = source.indexOf('>', matchIndex);
  if (tagEnd < 0) {
    return false;
  }
  return /\bdata-piwin-media\s*=/i.test(source.slice(tagStart, tagEnd + 1));
}

const PLACEHOLDER_ARTIFACT_SOURCE_PATTERN =
  /^(?:enter your code here\.{0,3}|todo|tbd|placeholder|\/\/\s*todo|<!--\s*(?:todo|placeholder|visible content here)\s*-->)$/i;

export function isPlaceholderArtifactSource(source: string): boolean {
  const trimmedSource = source.trim();
  return !trimmedSource || PLACEHOLDER_ARTIFACT_SOURCE_PATTERN.test(trimmedSource);
}

export function getUtf8ByteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function detectExternalArtifactResources(
  source: string,
  iframePolicy: ArtifactIframePolicy = createDefaultArtifactIframePolicy(),
): ExternalArtifactResource[] {
  const resources: ExternalArtifactResource[] = [];

  for (const entry of EXTERNAL_RESOURCE_PATTERNS) {
    entry.pattern.lastIndex = 0;
    for (const match of source.matchAll(entry.pattern)) {
      const url = match[2] || match[3];
      if (!url) {
        continue;
      }
      if (
        entry.kind === 'image' &&
        match.index !== undefined &&
        htmlTagHasSessionMediaBind(source, match.index)
      ) {
        continue;
      }
      resources.push({ kind: entry.kind, url });
    }
  }

  return resources.filter(
    (resource) =>
      !(resource.kind === 'iframe' && isAllowedArtifactIframeUrl(resource.url, iframePolicy)),
  );
}

export type ArtifactSecurityPolicy = {
  blockExternalScripts?: boolean;
  blockExternalResources?: boolean;
};

export function classifyArtifactSecurity(
  source: string,
  iframePolicy: ArtifactIframePolicy = createDefaultArtifactIframePolicy(),
  maxBytes: number = DEFAULT_MAX_ARTIFACT_BYTES,
  policy: ArtifactSecurityPolicy = {},
): ArtifactSecurityResult {
  const trimmedSource = source.trim();
  const byteSize = getUtf8ByteSize(trimmedSource);
  const externalResources = detectExternalArtifactResources(trimmedSource, iframePolicy);
  const blockExternalResources = policy.blockExternalResources !== false;
  const blockExternalScripts = policy.blockExternalScripts !== false;

  if (isPlaceholderArtifactSource(trimmedSource)) {
    return {
      canRender: false,
      blockReason: 'blocked-empty',
      byteSize,
      externalResources,
    };
  }

  if (byteSize > maxBytes) {
    return {
      canRender: false,
      blockReason: 'blocked-too-large',
      byteSize,
      externalResources,
    };
  }

  const scriptResources = externalResources.filter((resource) => resource.kind === 'script');
  const shouldBlock = blockExternalResources
    ? externalResources.length > 0
    : blockExternalScripts && scriptResources.length > 0;
  if (shouldBlock) {
    return {
      canRender: false,
      blockReason: 'blocked-external-resource',
      byteSize,
      externalResources,
    };
  }

  return {
    canRender: true,
    blockReason: null,
    byteSize,
    externalResources,
  };
}
