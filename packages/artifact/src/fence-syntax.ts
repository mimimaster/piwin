/**
 * Canonical fence info-string syntax: aliases, metadata, and stream marker.
 * No Markdown scanning lives here.
 */
import {
  ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  STREAMING_ARTIFACT_FENCE_MARKER,
} from './constants.js';
import type { ArtifactSurface } from './types.js';

export { STREAMING_ARTIFACT_FENCE_MARKER };

const ARTIFACT_ALIAS_SET = new Set<string>(ARTIFACT_LANGUAGE_ALIASES);
const NATIVE_HTML_SET = new Set<string>(NATIVE_HTML_ARTIFACT_LANGUAGES);
const NATIVE_SVG_SET = new Set<string>(NATIVE_SVG_ARTIFACT_LANGUAGES);

const FENCE_ATTRIBUTE_PATTERN =
  /(?:^|\s)([a-zA-Z][-_a-zA-Z0-9]*)\s*=\s*(?:(["'])(.*?)\2|([^\s]+))/g;

export function stripFenceInfo(language: string): string {
  return language.trim();
}

export function hasStreamingArtifactMarker(language: string): boolean {
  return stripFenceInfo(language).split(/\s+/).includes(STREAMING_ARTIFACT_FENCE_MARKER);
}

export function stripStreamingArtifactMarker(language: string): string {
  return stripFenceInfo(language)
    .split(/\s+/)
    .filter((token) => token !== STREAMING_ARTIFACT_FENCE_MARKER)
    .join(' ');
}

export function getFenceAlias(rawLanguage: string): string {
  return stripFenceInfo(rawLanguage).split(/\s+/)[0]?.toLowerCase() ?? '';
}

export function getFenceLanguageToken(info: string): string {
  return stripFenceInfo(info).split(/\s+/)[0] ?? '';
}

function normalizeFenceKey(key: string): string {
  return key.trim().toLowerCase().replace(/_/g, '-');
}

export function parseFenceAttributes(rawLanguage: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of stripFenceInfo(rawLanguage).matchAll(FENCE_ATTRIBUTE_PATTERN)) {
    const key = normalizeFenceKey(match[1] ?? '');
    const value = (match[3] ?? match[4] ?? '').trim();
    if (key && value) {
      attributes.set(key, value);
    }
  }
  return attributes;
}

export function parseFenceTitle(rawLanguage: string): string | null {
  const attributes = parseFenceAttributes(rawLanguage);
  return (
    attributes.get('title') ??
    attributes.get('artifact-title') ??
    attributes.get('name') ??
    attributes.get('artifact-name') ??
    null
  );
}

export function parseFenceSurface(rawLanguage: string): ArtifactSurface {
  const value = parseFenceAttributes(rawLanguage).get('surface')?.toLowerCase();
  return value === 'canvas' ? 'canvas' : 'inline';
}

export function isExplicitArtifactAlias(rawLanguage: string): boolean {
  return ARTIFACT_ALIAS_SET.has(getFenceAlias(rawLanguage));
}

export function isNativeHtmlLanguage(rawLanguage: string): boolean {
  return NATIVE_HTML_SET.has(getFenceAlias(rawLanguage));
}

export function isNativeSvgLanguage(rawLanguage: string): boolean {
  return NATIVE_SVG_SET.has(getFenceAlias(rawLanguage));
}

export function isNativeArtifactLanguage(rawLanguage: string): boolean {
  return isNativeHtmlLanguage(rawLanguage) || isNativeSvgLanguage(rawLanguage);
}

/** Open fences that receive a synthetic closer (and native stream marker) in projection. */
export function isProjectableStreamingFence(rawLanguage: string): boolean {
  const info = stripStreamingArtifactMarker(rawLanguage);
  return isExplicitArtifactAlias(info) || isNativeArtifactLanguage(info);
}
