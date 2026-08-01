/**
 * Detect HTML artifact candidates from markdown code-fence metadata + source heuristics.
 * Ported/simplified from openwebui_m artifactParser.ts — no Svelte/token host coupling.
 */
import {
  AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES,
  ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
} from './constants.js';
import { normalizeHtmlDocumentToArtifactFragment } from './html-document-fragment.js';
import type { ArtifactDescriptor } from './types.js';

const ARTIFACT_ALIAS_SET = new Set<string>(ARTIFACT_LANGUAGE_ALIASES);
const AMBIGUOUS_ALIAS_SET = new Set<string>(AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES);
const NATIVE_HTML_SET = new Set<string>(NATIVE_HTML_ARTIFACT_LANGUAGES);
const NATIVE_SVG_SET = new Set<string>(NATIVE_SVG_ARTIFACT_LANGUAGES);

const PLACEHOLDER_SOURCE_PATTERN =
  /^(?:enter your code here\.{0,3}|todo|tbd|placeholder|\/\/\s*todo|<!--\s*(?:todo|placeholder|visible content here)\s*-->)$/i;
const HTML_LIKE_SOURCE_PATTERN =
  /<\s*(?:style|script|div|section|article|main|aside|header|footer|button|input|select|textarea|form|table|ul|ol|li|details|summary|dialog|canvas|svg)\b|--piwin-artifact-/i;
const SVG_SOURCE_PATTERN =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b[\s\S]*(?:<\/svg\s*>|\/>)\s*$/i;
const NATIVE_HTML_UI_SOURCE_PATTERN =
  /(?:<!doctype\s+html\b|<\s*html\b|<\s*body\b|<\s*style\b|<\s*iframe\b|<\s*(?:section|main|article|details|summary|form|button|table)\b|<\s*div\b[^>]*(?:class|id)\s*=)/i;
const FENCE_ATTRIBUTE_PATTERN =
  /(?:^|\s)([a-zA-Z][-_a-zA-Z0-9]*)\s*=\s*(?:(["'])(.*?)\2|([^\s]+))/g;

export type MarkdownFenceBlock = {
  language: string;
  source: string;
};

export type TableAlignment = 'left' | 'center' | 'right' | 'default';

export type ParsedMarkdownBlock =
  | { type: 'paragraph'; value: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'blockquote'; text: string; kind?: 'note' | 'tip' | 'important' | 'warning' | 'caution' }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'code'; language: string; source: string }
  | {
      type: 'table';
      headers: string[];
      alignments: TableAlignment[];
      rows: string[][];
    };

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

function isNativeSvgLanguage(rawLanguage: string): boolean {
  return NATIVE_SVG_SET.has(getAlias(rawLanguage));
}

function isSvgSource(source: string): boolean {
  return SVG_SOURCE_PATTERN.test(source);
}

/**
 * Decide whether a fenced code block should become an HTML or SVG artifact.
 * When htmlUiMode is false, never promote native ```html``` or ```svg``` fences.
 */
export function tryParseArtifactFence(input: {
  language: string;
  source: string;
  id: string;
  htmlUiModeEnabled?: boolean;
}): ArtifactDescriptor | null {
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

  if (isNativeSvgLanguage(rawLanguage)) {
    if (!htmlUiModeEnabled || !isSvgSource(source)) {
      return null;
    }
    return {
      id: input.id,
      type: 'svg',
      title: parseTitle(rawLanguage) ?? 'SVG',
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

export function tryParseHtmlArtifactFence(input: {
  language: string;
  source: string;
  id: string;
  htmlUiModeEnabled?: boolean;
}): ArtifactDescriptor | null {
  return tryParseArtifactFence(input);
}

function parseTableRow(line: string): string[] {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);
  return content.split('|').map((cell) => cell.trim());
}

function parseTableAlignment(delimiterCell: string): TableAlignment {
  const cell = delimiterCell.trim();
  const starts = cell.startsWith(':');
  const ends = cell.endsWith(':');
  if (starts && ends) return 'center';
  if (ends) return 'right';
  if (starts) return 'left';
  return 'default';
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(trimmed);
}

/**
 * Split markdown into paragraphs, lists, tables, headings, callouts, and fenced code blocks.
 * Kept simple and deterministic for chat rendering.
 */
export function splitMarkdownBlocks(text: string): ParsedMarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: ParsedMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      index += 1;
      continue;
    }

    // Fenced code blocks
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
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

    // Tables: must have current line with '|' and next line as table delimiter
    if (
      trimmed.includes('|') &&
      index + 1 < lines.length &&
      isTableDelimiterLine(lines[index + 1] ?? '')
    ) {
      const headers = parseTableRow(line);
      const delimiterCells = parseTableRow(lines[index + 1] ?? '');
      const alignments = delimiterCells.map(parseTableAlignment);
      index += 2;

      const rows: string[][] = [];
      while (
        index < lines.length &&
        (lines[index] ?? '').trim() !== '' &&
        !(lines[index] ?? '').trim().startsWith('```') &&
        (lines[index] ?? '').includes('|')
      ) {
        rows.push(parseTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'table', headers, alignments, rows });
      continue;
    }

    // Headings (# Heading)
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    // Callouts & Blockquotes (> text or > [!NOTE])
    if (trimmed.startsWith('>')) {
      const calloutMatch = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(trimmed);
      let kind: 'note' | 'tip' | 'important' | 'warning' | 'caution' | undefined;
      const quoteLines: string[] = [];

      if (calloutMatch && calloutMatch[1]) {
        kind = calloutMatch[1].toLowerCase() as 'note' | 'tip' | 'important' | 'warning' | 'caution';
        const restOfFirstLine = trimmed.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i, '').trim();
        if (restOfFirstLine) {
          quoteLines.push(restOfFirstLine);
        }
        index += 1;
      } else {
        quoteLines.push(trimmed.replace(/^>\s?/, ''));
        index += 1;
      }

      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }

      blocks.push({
        type: 'blockquote',
        text: quoteLines.join('\n'),
        ...(kind ? { kind } : {}),
      });
      continue;
    }

    // Bullet lists (- or *)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', items, ordered: false });
      continue;
    }

    // Ordered lists (1. 2.)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', items, ordered: true });
      continue;
    }

    // Paragraph
    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !(lines[index] ?? '').trim().startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[index] ?? '') &&
      !/^\s*\d+\.\s+/.test(lines[index] ?? '') &&
      !/^(#{1,6})\s+/.test((lines[index] ?? '').trim()) &&
      !(lines[index] ?? '').trim().startsWith('>') &&
      !((lines[index] ?? '').includes('|') && index + 1 < lines.length && isTableDelimiterLine(lines[index + 1] ?? ''))
    ) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push({ type: 'paragraph', value: paragraphLines.join('\n') });
  }

  return blocks;
}
