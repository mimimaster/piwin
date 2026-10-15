/**
 * Recovery for artifacts a model wrapped in `<artifact-html …>…</artifact-html>`
 * tags instead of a fence. The prompt only teaches fences; this keeps a slip
 * from reaching the transcript as escaped HTML text. Pure line parsing only.
 */
import { ARTIFACT_LANGUAGE_ALIASES } from './constants.js';

const ARTIFACT_TAG_SET = new Set<string>(ARTIFACT_LANGUAGE_ALIASES);
const TAG_NAME_PATTERN = /^[A-Za-z][-_A-Za-z0-9]*/;

export type ArtifactOpeningTag = {
  /** Offset of `<` within the line. */
  tagIndex: number;
  /** Offset just past the closing `>` within the line. */
  tagEnd: number;
  /** Lower-cased tag name; doubles as the fence language token. */
  tagName: string;
  /** Equivalent fence info string, e.g. `artifact-html title="x" style="host"`. */
  info: string;
  /** Body text that follows the tag on the same line ('' when the tag stands alone). */
  trailing: string;
};

/** Index just past the `>` that ends a tag opened before `from`, honoring quotes. */
function findTagEnd(text: string, from: number): number | null {
  let quote: string | null = null;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index + 1;
    }
  }
  return null;
}

/**
 * A line that opens a tag-form artifact: up to 3 spaces, then a complete
 * `<artifact-html …>` tag. Anything after the tag must already be HTML, so a
 * prose mention such as "<artifact-html> is the tag" stays text.
 */
export function parseArtifactOpeningTag(text: string): ArtifactOpeningTag | null {
  let tagIndex = 0;
  while (tagIndex < 3 && text[tagIndex] === ' ') tagIndex += 1;
  if (text[tagIndex] !== '<') return null;
  const name = TAG_NAME_PATTERN.exec(text.slice(tagIndex + 1))?.[0];
  if (!name || !ARTIFACT_TAG_SET.has(name.toLowerCase())) return null;
  const attributesStart = tagIndex + 1 + name.length;
  const next = text[attributesStart];
  if (next !== '>' && next !== ' ' && next !== '\t') return null;
  const tagEnd = findTagEnd(text, attributesStart);
  if (tagEnd === null) return null;
  const attributes = text.slice(attributesStart, tagEnd - 1).trim();
  // Self-closing tags carry no body; a backtick would break the fence info.
  if (attributes.endsWith('/') || attributes.includes('`')) return null;
  const trailing = text.slice(tagEnd).trim();
  if (trailing && !trailing.startsWith('<')) return null;
  const tagName = name.toLowerCase();
  return {
    tagIndex,
    tagEnd,
    tagName,
    info: attributes ? `${tagName} ${attributes}` : tagName,
    trailing,
  };
}

/** Offset of the `</tagName>` that ends the line (case-insensitive), or null. */
export function findArtifactClosingTag(text: string, tagName: string): number | null {
  const trimmed = text.trimEnd();
  const closer = `</${tagName}>`;
  if (trimmed.length < closer.length) return null;
  const start = trimmed.length - closer.length;
  return trimmed.slice(start).toLowerCase() === closer ? start : null;
}
