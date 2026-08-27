/**
 * Streamable preview builder for artifact HTML.
 * Safe incremental preview while the model is still streaming an unfinished fence.
 * Ported from openwebui_m artifactStreamablePreview — no script tails executed.
 */
import type { StreamablePreviewResult } from './types.js';

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const COMPLETE_SCRIPT_PATTERN = /<script\b[\s\S]*?<\/script\s*>/gi;
const COMPLETE_STYLE_PATTERN = /<style\b[\s\S]*?<\/style\s*>/i;
const TRAILING_INCOMPLETE_SCRIPT_PATTERN = /<script\b[\s\S]*$/i;
const TRAILING_INCOMPLETE_STYLE_PATTERN = /<style\b(?:(?!<\/style>).)*$/is;
const INLINE_EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL_PATTERN = /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;
const UNSAFE_EMBED_PATTERN =
  /<(?:iframe|object|embed)\b[\s\S]*?(?:<\/(?:iframe|object|embed)\s*>|$)/gi;
const GENERIC_STREAMABLE_STRUCTURE_PATTERN =
  /<(?:section|article|main|table|thead|tbody|tr|ul|ol|form|svg|canvas|div)\b/i;
const GENERIC_STREAMABLE_TAGS = new Set([
  'section',
  'article',
  'main',
  'table',
  'thead',
  'tbody',
  'tr',
  'ul',
  'ol',
  'form',
  'svg',
  'canvas',
  'div',
]);
const STREAM_REVEAL_IGNORED_BOUNDARY_TAGS = new Set(['style', 'script']);

type TagEntry = {
  tag: string;
  tagName: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  position: number;
};

function extractTagName(tagContent: string): string {
  const cleaned = tagContent.replace(/^<\//, '<').replace(/\/>$/, '>');
  const match = cleaned.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  return match ? (match[1] ?? '').toLowerCase() : '';
}

function sanitizeStreamingPreviewSource(source: string): string {
  return source
    .replace(COMPLETE_SCRIPT_PATTERN, '')
    .replace(TRAILING_INCOMPLETE_SCRIPT_PATTERN, '')
    .replace(TRAILING_INCOMPLETE_STYLE_PATTERN, '')
    .replace(UNSAFE_EMBED_PATTERN, '')
    .replace(INLINE_EVENT_HANDLER_PATTERN, '')
    .replace(JAVASCRIPT_URL_PATTERN, '$1=$2#$2');
}

/**
 * A late stylesheet is safe to move ahead of fragment markup in preview mode.
 * This gives every staged DOM prefix the same completed visual foundation.
 * Full documents keep authored head/body order; the runtime protocol asks
 * models to emit fragment CSS first, so this is a defensive fallback.
 */
function hoistFragmentStyleFoundation(source: string): string {
  if (/<(?:!doctype|html|head|body)\b/i.test(source)) {
    return source;
  }
  const styles: string[] = [];
  const markup = source.replace(/<style\b[\s\S]*?<\/style\s*>/gi, (style) => {
    styles.push(style);
    return '';
  });
  return styles.length > 0 ? `${styles.join('\n')}${markup}` : source;
}

function findTagEnd(source: string, startIndex: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      return index;
    }
  }
  return -1;
}

function* scanTags(source: string): Generator<TagEntry> {
  const length = source.length;
  let position = 0;

  while (position < length) {
    if (source.startsWith('<!--', position)) {
      const endIndex = source.indexOf('-->', position + 4);
      if (endIndex === -1) {
        return;
      }
      position = endIndex + 3;
      continue;
    }

    if (source.slice(position).match(/^<!DOCTYPE\s/i)) {
      const endIndex = source.indexOf('>', position);
      if (endIndex === -1) {
        return;
      }
      position = endIndex + 1;
      continue;
    }

    const leftAngleIndex = source.indexOf('<', position);
    if (leftAngleIndex === -1) {
      return;
    }

    const rightAngleIndex = findTagEnd(source, leftAngleIndex);
    if (rightAngleIndex === -1) {
      return;
    }

    const tag = source.slice(leftAngleIndex, rightAngleIndex + 1);
    const tagName = extractTagName(tag);
    position = rightAngleIndex + 1;

    if (!tagName) {
      continue;
    }

    yield {
      tag,
      tagName,
      isClosing: tag.trim().startsWith('</'),
      isSelfClosing: tag.trim().endsWith('/>') || VOID_TAGS.has(tagName),
      position: leftAngleIndex,
    };
  }
}

function hasInlineStyle(tag: string): boolean {
  return /\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/i.test(tag);
}

function hasClassName(tag: string): boolean {
  return /\sclass\s*=\s*(?:"[^"]+"|'[^']+')/i.test(tag);
}

/**
 * Class-driven markup without a completed stylesheet has no stable visual
 * meaning. Models sometimes emit the whole DOM and append CSS afterwards;
 * exposing that prefix paints a raw document flow that later collapses into
 * an unrelated scene. Inline-styled nodes remain independently renderable.
 */
function findMissingStyleFoundationIndex(source: string): number | null {
  if (COMPLETE_STYLE_PATTERN.test(source)) {
    return null;
  }
  for (const tag of scanTags(source)) {
    if (!tag.isClosing && hasClassName(tag.tag) && !hasInlineStyle(tag.tag)) {
      return tag.position;
    }
  }
  return null;
}

function buildSyntheticClosers(openTagStack: string[]): string {
  return openTagStack
    .slice()
    .reverse()
    .map((tagName) => `</${tagName}>`)
    .join('');
}

function buildPreviewFromSafePrefix(source: string, safeEndIndex: number): StreamablePreviewResult {
  const previewPrefix = source.slice(0, safeEndIndex);
  let openTagStack: string[] = [];

  for (const tag of scanTags(previewPrefix)) {
    if (tag.isSelfClosing) {
      continue;
    }
    if (tag.isClosing) {
      const lastOpenTag = openTagStack[openTagStack.length - 1];
      if (lastOpenTag === tag.tagName) {
        openTagStack = openTagStack.slice(0, -1);
      } else {
        const recoveryIndex = openTagStack.lastIndexOf(tag.tagName);
        if (recoveryIndex !== -1) {
          openTagStack = openTagStack.slice(0, recoveryIndex);
        }
      }
      continue;
    }
    openTagStack.push(tag.tagName);
  }

  const previewSource = `${previewPrefix}${buildSyntheticClosers(openTagStack)}`;
  return {
    canStream: previewSource.trim().length > 0,
    previewSource,
  };
}

export function buildStreamableArtifactPreview(source: string): StreamablePreviewResult {
  if (!source.trim()) {
    return { canStream: false, previewSource: source };
  }

  const sanitizedSource = hoistFragmentStyleFoundation(sanitizeStreamingPreviewSource(source));
  if (!sanitizedSource.trim()) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  const missingStyleFoundationIndex = findMissingStyleFoundationIndex(sanitizedSource);
  const stableCandidateSource =
    missingStyleFoundationIndex === null
      ? sanitizedSource
      : sanitizedSource.slice(0, missingStyleFoundationIndex);

  if (!GENERIC_STREAMABLE_STRUCTURE_PATTERN.test(stableCandidateSource)) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  let openTagStack: string[] = [];
  let lastSafeEndIndex = -1;
  let hasStableStructure = false;

  for (const tag of scanTags(stableCandidateSource)) {
    if (!tag.isClosing && GENERIC_STREAMABLE_TAGS.has(tag.tagName)) {
      hasStableStructure = true;
    }
    if (tag.isSelfClosing) {
      lastSafeEndIndex = tag.position + tag.tag.length;
      continue;
    }

    if (tag.isClosing) {
      const lastOpenTag = openTagStack[openTagStack.length - 1];
      if (lastOpenTag === tag.tagName) {
        openTagStack = openTagStack.slice(0, -1);
      } else {
        const recoveryIndex = openTagStack.lastIndexOf(tag.tagName);
        if (recoveryIndex !== -1) {
          openTagStack = openTagStack.slice(0, recoveryIndex);
        }
      }
      lastSafeEndIndex = tag.position + tag.tag.length;
      continue;
    }

    openTagStack.push(tag.tagName);
  }

  if (!hasStableStructure || lastSafeEndIndex <= 0) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  const previewResult = buildPreviewFromSafePrefix(stableCandidateSource, lastSafeEndIndex);
  if (!previewResult.canStream) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  if (!GENERIC_STREAMABLE_STRUCTURE_PATTERN.test(previewResult.previewSource)) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  return previewResult;
}

/**
 * Split one large safe snapshot into a bounded series of structurally closed
 * prefixes. Used only when a late stylesheet turns a previously withheld
 * scene into one large renderSource jump; ordinary provider deltas stay native.
 */
export function buildStableArtifactRevealFrames(source: string, maxFrames = 8): readonly string[] {
  if (!source.trim()) {
    return [];
  }
  if (maxFrames <= 1) {
    return [source];
  }

  const stableEndIndices: number[] = [];
  for (const tag of scanTags(source)) {
    if (
      (tag.isClosing || tag.isSelfClosing) &&
      !STREAM_REVEAL_IGNORED_BOUNDARY_TAGS.has(tag.tagName)
    ) {
      const endIndex = tag.position + tag.tag.length;
      if (GENERIC_STREAMABLE_STRUCTURE_PATTERN.test(source.slice(0, endIndex))) {
        stableEndIndices.push(endIndex);
      }
    }
  }
  stableEndIndices.push(source.length);

  const uniqueEndIndices = [...new Set(stableEndIndices)].sort((left, right) => left - right);
  const frameCount = Math.min(Math.floor(maxFrames), uniqueEndIndices.length);
  const selectedEndIndices = Array.from({ length: frameCount }, (_unused, index) => {
    if (frameCount === 1) {
      return uniqueEndIndices[uniqueEndIndices.length - 1] ?? source.length;
    }
    const candidateIndex = Math.round((index * (uniqueEndIndices.length - 1)) / (frameCount - 1));
    return uniqueEndIndices[candidateIndex] ?? source.length;
  });

  const frames = selectedEndIndices
    .map((endIndex) => buildPreviewFromSafePrefix(source, endIndex))
    .filter(
      (result) =>
        result.canStream && GENERIC_STREAMABLE_STRUCTURE_PATTERN.test(result.previewSource),
    )
    .map((result) => result.previewSource);
  if (frames[frames.length - 1] !== source) {
    frames.push(source);
  }
  return [...new Set(frames)];
}
