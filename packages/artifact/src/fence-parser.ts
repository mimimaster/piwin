/**
 * FenceRecord / info-string → ArtifactDescriptor. Explicit aliases and native
 * HTML/SVG only — no fuzzy artifact* heuristics or tag blocks.
 */
import { isFullHtmlDocument } from './html-document.js';
import type { ArtifactFenceRecord } from './fence-index.js';
import {
  STREAMING_ARTIFACT_FENCE_MARKER,
  getFenceAlias,
  hasStreamingArtifactMarker,
  isExplicitArtifactAlias,
  isNativeHtmlLanguage,
  isNativeSvgLanguage,
  parseFenceSurface,
  parseFenceTitle,
  stripFenceInfo,
  stripStreamingArtifactMarker,
} from './fence-syntax.js';
import type { ArtifactDescriptor } from './types.js';

const SVG_SOURCE_PATTERN = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b[\s\S]*(?:<\/svg\s*>|\/>)\s*$/i;
const SVG_OPEN_SOURCE_PATTERN = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/i;
const NATIVE_HTML_UI_SOURCE_PATTERN =
  /(?:<!doctype\s+html\b|<\s*html\b|<\s*body\b|<\s*style\b|<\s*iframe\b|<\s*(?:section|main|article|details|summary|form|button|table)\b|<\s*div\b[^>]*(?:class|id)\s*=)/i;

function isUiLikeHtmlSource(source: string): boolean {
  return NATIVE_HTML_UI_SOURCE_PATTERN.test(source);
}

function isSvgSource(source: string, allowIncompleteSource: boolean): boolean {
  return (
    SVG_SOURCE_PATTERN.test(source) ||
    (allowIncompleteSource && SVG_OPEN_SOURCE_PATTERN.test(source))
  );
}

export type ParseArtifactFenceInput = {
  language: string;
  source: string;
  id: string;
  htmlUiModeEnabled?: boolean;
  allowIncompleteSource?: boolean;
};

/**
 * Decide whether a fenced code block should become an HTML or SVG artifact.
 * When htmlUiMode is false, never promote native ```html``` or ```svg``` fences.
 */
function parseArtifactFence(input: ParseArtifactFenceInput): ArtifactDescriptor | null {
  const htmlUiModeEnabled = input.htmlUiModeEnabled !== false;
  const streamDeclaredNativeArtifact =
    input.allowIncompleteSource === true && hasStreamingArtifactMarker(input.language);
  const rawLanguage = stripStreamingArtifactMarker(input.language);
  const alias = getFenceAlias(rawLanguage);
  const source = input.source;
  const surface = parseFenceSurface(rawLanguage);

  if (isExplicitArtifactAlias(rawLanguage)) {
    return {
      id: input.id,
      type: 'html',
      title: parseFenceTitle(rawLanguage) ?? 'HTML UI',
      source,
      rawLanguage,
      alias,
      declaration: 'explicit',
      documentKind: isFullHtmlDocument(source) ? 'document' : 'fragment',
      surface,
    };
  }

  if (isNativeSvgLanguage(rawLanguage)) {
    if (
      !htmlUiModeEnabled ||
      (!streamDeclaredNativeArtifact && !isSvgSource(source, input.allowIncompleteSource === true))
    ) {
      return null;
    }
    return {
      id: input.id,
      type: 'svg',
      title: parseFenceTitle(rawLanguage) ?? 'SVG',
      source,
      rawLanguage,
      alias,
      declaration: 'native',
      documentKind: 'fragment',
      surface,
    };
  }

  if (
    htmlUiModeEnabled &&
    isNativeHtmlLanguage(rawLanguage) &&
    (streamDeclaredNativeArtifact || isUiLikeHtmlSource(source))
  ) {
    return {
      id: input.id,
      type: 'html',
      title: parseFenceTitle(rawLanguage) ?? 'HTML UI',
      source,
      rawLanguage,
      alias,
      declaration: 'native',
      documentKind: isFullHtmlDocument(source) ? 'document' : 'fragment',
      surface,
    };
  }

  return null;
}

export function parseArtifactFenceRecord(
  record: ArtifactFenceRecord,
  options: {
    id: string;
    htmlUiModeEnabled?: boolean;
    allowIncompleteSource?: boolean;
  },
): ArtifactDescriptor | null {
  const allowIncompleteSource = options.allowIncompleteSource === true;
  let language = stripFenceInfo(record.info);
  if (
    allowIncompleteSource &&
    record.open &&
    !hasStreamingArtifactMarker(language) &&
    (isNativeHtmlLanguage(language) || isNativeSvgLanguage(language))
  ) {
    language = `${language} ${STREAMING_ARTIFACT_FENCE_MARKER}`;
  }
  const input: ParseArtifactFenceInput = {
    language,
    source: record.source,
    id: options.id,
    allowIncompleteSource,
  };
  if (options.htmlUiModeEnabled !== undefined) {
    input.htmlUiModeEnabled = options.htmlUiModeEnabled;
  }
  return parseArtifactFence(input);
}
