import { DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES } from './constants.js';
import type { ArtifactIframePolicy, ArtifactIframePolicyMode } from './types.js';

export function createDefaultArtifactIframePolicy(
  mode: ArtifactIframePolicyMode = 'allowlist',
): ArtifactIframePolicy {
  return {
    mode,
    allowedUrlPrefixes: [...DEFAULT_ARTIFACT_IFRAME_ALLOWED_URL_PREFIXES],
  };
}

/** Keep only http(s) prefixes; trim, dedupe. */
export function sanitizeArtifactIframeAllowlist(prefixes?: string[]): string[] {
  if (!prefixes || prefixes.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const prefix of prefixes) {
    const trimmed = prefix.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function normalizeArtifactIframeUrl(url: string): string {
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url;
}

export function isHttpArtifactIframeUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function isAllowedArtifactIframeUrl(
  url: string,
  policy: ArtifactIframePolicy,
): boolean {
  const normalizedUrl = normalizeArtifactIframeUrl(url);
  if (!isHttpArtifactIframeUrl(normalizedUrl)) {
    return false;
  }
  if (policy.mode === 'permissive') {
    return true;
  }
  if (policy.mode === 'disabled') {
    return false;
  }
  return policy.allowedUrlPrefixes.some((prefix) => normalizedUrl.startsWith(prefix));
}

export function buildArtifactFrameSrcCsp(policy: ArtifactIframePolicy): string {
  if (policy.mode === 'disabled') {
    return "frame-src 'none'";
  }
  if (policy.mode === 'permissive') {
    return 'frame-src http: https:';
  }
  if (policy.allowedUrlPrefixes.length === 0) {
    return "frame-src 'none'";
  }
  const origins = policy.allowedUrlPrefixes
    .map((prefix) => {
      try {
        const parsed = new URL(prefix);
        return `${parsed.protocol}//${parsed.hostname}`;
      } catch {
        return '';
      }
    })
    .filter((origin) => origin.length > 0);
  if (origins.length === 0) {
    return "frame-src 'none'";
  }
  // de-dupe origins while preserving order
  return `frame-src ${[...new Set(origins)].join(' ')}`;
}
