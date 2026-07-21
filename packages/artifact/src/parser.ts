/**
 * Detect HTML artifact candidates from markdown code-fence metadata + source heuristics.
 * Ported/simplified from openwebui_m artifactParser.ts — no Svelte/token host coupling.
 */
import {
  AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES,
  ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
} from './constants.js';
import { normalizeHtmlDocumentToArtifactFragment } from './html-document-fragment.js';
import type { HtmlArtifactDescriptor } from './types.js';

const ARTIFACT_ALIAS_SET = new Set<string>(ARTIFACT_LANGUAGE_ALIASES);
const AMBIGUOUS_ALIAS_SET = new Set<string>(AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES);
const NATIVE_HTML_SET = new Set<string>(NATIVE_HTML_ARTIFACT_LANGUAGES);

const PLACEHOLDER_SOURCE_PATTERN =
  /^(?:enter your code here\.{0,3}|todo|tbd|placeholder|\/\/\s*todo|<!--\s*(?:todo|placeholder|visible content here)\s*-->)$/i;
const HTML_LIKE_SOURCE_PATTERN =
  /<\s*(?:style|script|div|section|article|main|aside|header|footer|button|input|select|textarea|form|table|ul|ol|li|details|summary|dialog|canvas|svg)\b|--piwin-artifact-/i;
const NATIVE_HTML_UI_SOURCE_PATTERN =
  /(?:<!doctype\s+html\b|<\s*html\b|<\s*body\b|<\s*style\b|<\s*iframe\b|<\s*(?:section|main|article|details|summary|form|button|table)\b|<\s*div\b[^>]*(?:class|id)\s*=)/i;
const FENCE_ATTRIBUTE_PATTERN =
  /(?:^|\s)([a-zA-Z][-_a-zA-Z0-9]*)\s*=\s*(?:(["'])(.*?)\2|([^\s]+))/g;

export type MarkdownFenceBlock = {
  language: string;
  source: string;
};

export type ParsedMarkdownBlock =
  | { type: 'paragraph'; value: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; source: string };

function stripFenceInfo(language: string): string {
  return language.trim();
}

function getAlias(rawLanguage: string): string {
  return stripFenceInfo(rawLanguage).split(/\s+/)[0]?.toLowerCase() ?? '';
}

function normalizeFenceKey(key: string): string {
  return key.trim().toLowerCase().replace(/_/g, '-');
}

function parseFenceAttributes(rawLanguage: string): Map<string, string> {
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

function parseTitle(rawLanguage: string): string | null {
  const attributes = parseFenceAttributes(rawLanguage);
  return (
    attributes.get('title') ??
    attributes.get('artifact-title') ??
    attributes.get('name') ??
    attributes.get('artifact-name') ??
    null
  );
}

function isArtifactFenceMarker(rawLanguage: string): boolean {
  const alias = getAlias(rawLanguage);
  const attributes = parseFenceAttributes(rawLanguage);
  return (
    alias === 'artifact' ||
    alias.startsWith('artifact-') ||
    alias.startsWith('artifact_') ||
    alias.endsWith('-artifact') ||
    alias.endsWith('_artifact') ||
    [...attributes.keys()].some(
      (key) => key === 'artifact' || key.startsWith('artifact-'),
    )
  );
}

function isPlaceholderSource(source: string): boolean {
  const trimmed = source.trim();
  return !trimmed || PLACEHOLDER_SOURCE_PATTERN.test(trimmed);
}

function isHtmlLikeSource(source: string): boolean {
  return HTML_LIKE_SOURCE_PATTERN.test(source);
}

function isUiLikeHtmlSource(source: string): boolean {
  return NATIVE_HTML_UI_SOURCE_PATTERN.test(source);
}

function isExplicitArtifactAlias(rawLanguage: string): boolean {
  return ARTIFACT_ALIAS_SET.has(getAlias(rawLanguage));
}

function isAmbiguousArtifactAlias(rawLanguage: string): boolean {
  return AMBIGUOUS_ALIAS_SET.has(getAlias(rawLanguage));
}

function isNativeHtmlLanguage(rawLanguage: string): boolean {
  return NATIVE_HTML_SET.has(getAlias(rawLanguage));
}

/**
 * Decide whether a fenced code block should become an HTML artifact.
 * When htmlUiMode is false, never promote native ```html``` fences.
 */
export function tryParseHtmlArtifactFence(input: {
  language: string;
  source: string;
  id: string;
  htmlUiModeEnabled?: boolean;
}): HtmlArtifactDescriptor | null {
  const htmlUiModeEnabled = input.htmlUiModeEnabled !== false;
  const rawLanguage = stripFenceInfo(input.language);
  const alias = getAlias(rawLanguage);
  const source = input.source;

  if (isExplicitArtifactAlias(rawLanguage)) {
    return {
      id: input.id,
      type: 'html',
      title: parseTitle(rawLanguage) ?? 'HTML UI',
      source,
      rawLanguage,
      alias,
    };
  }

  if (
    (isArtifactFenceMarker(rawLanguage) || isAmbiguousArtifactAlias(rawLanguage)) &&
    (isPlaceholderSource(source) || isHtmlLikeSource(source))
  ) {
    return {
      id: input.id,
      type: 'html',
      title: parseTitle(rawLanguage) ?? 'HTML UI',
      source,
      rawLanguage,
      alias,
    };
  }

  if (
    htmlUiModeEnabled &&
    isNativeHtmlLanguage(rawLanguage) &&
    isUiLikeHtmlSource(source)
  ) {
    return {
      id: input.id,
      type: 'html',
      title: parseTitle(rawLanguage) ?? 'HTML UI',
      source: normalizeHtmlDocumentToArtifactFragment(source),
      rawLanguage,
      alias,
    };
  }

  return null;
}

/**
 * Split markdown into paragraphs, lists, and fenced code blocks.
 * Kept simple and deterministic for chat rendering.
 */
export function splitMarkdownBlocks(text: string): ParsedMarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: ParsedMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'code', language, source: codeLines.join('\n') });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !(lines[index] ?? '').trim().startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push({ type: 'paragraph', value: paragraphLines.join('\n') });
  }

  return blocks;
}
