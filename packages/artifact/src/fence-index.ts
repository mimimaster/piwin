/**
 * Linear CommonMark fenced-code indexer. Offsets are UTF-16 JS string indices
 * and match Streamdown `node.position.start.offset` on the same markdown.
 */
import { getFenceLanguageToken } from './fence-syntax.js';

export type ArtifactFenceRecord = {
  ordinal: number;
  startOffset: number;
  endOffset: number | null;
  info: string;
  language: string;
  source: string;
  open: boolean;
};

/** Build a record for analysis when the caller is not indexing Markdown. */
export function createArtifactFenceRecord(input: {
  info: string;
  source: string;
  ordinal?: number;
  startOffset?: number;
  open?: boolean;
}): ArtifactFenceRecord {
  const open = input.open === true;
  const startOffset = input.startOffset ?? 0;
  return {
    ordinal: input.ordinal ?? 0,
    startOffset,
    endOffset: open ? null : startOffset,
    info: input.info,
    language: getFenceLanguageToken(input.info),
    source: input.source,
    open,
  };
}

type MarkdownLine = {
  start: number;
  text: string;
  newlineLength: number;
};

type OpeningFence = {
  markerIndex: number;
  marker: '`' | '~';
  markerLength: number;
  info: string;
  quoteDepth: number;
  contentColumn: number;
};

const LIST_MARKER_PATTERN = /^([-*+] |\d{1,9}[.)] )/;

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== '\n') {
      continue;
    }
    let textEnd = index;
    if (textEnd > start && markdown[textEnd - 1] === '\r') {
      textEnd -= 1;
    }
    lines.push({
      start,
      text: markdown.slice(start, textEnd),
      newlineLength: index + 1 - textEnd,
    });
    start = index + 1;
  }
  lines.push({ start, text: markdown.slice(start), newlineLength: 0 });
  return lines;
}

function consumeBlockquoteMarker(text: string, from: number): number {
  let index = from;
  let spaces = 0;
  while (spaces < 3 && text[index] === ' ') {
    spaces += 1;
    index += 1;
  }
  if (text[index] !== '>') {
    return from;
  }
  index += 1;
  if (text[index] === ' ') {
    index += 1;
  }
  return index;
}

function parseOpeningFence(text: string): OpeningFence | null {
  let index = 0;
  let quoteDepth = 0;
  let quotePrefixLength = 0;

  while (index < text.length) {
    const next = consumeBlockquoteMarker(text, index);
    if (next === index) {
      break;
    }
    quoteDepth += 1;
    quotePrefixLength = next;
    index = next;
  }

  let listIndex = index;
  let listSpaces = 0;
  while (listSpaces < 3 && text[listIndex] === ' ') {
    listSpaces += 1;
    listIndex += 1;
  }
  const listMatch = LIST_MARKER_PATTERN.exec(text.slice(listIndex));
  if (listMatch?.[1]) {
    index = listIndex + listMatch[1].length;
  }

  let indent = 0;
  while (indent < 3 && text[index] === ' ') {
    indent += 1;
    index += 1;
  }

  const marker = text[index];
  if (marker !== '`' && marker !== '~') {
    return null;
  }
  let markerLength = 0;
  while (text[index + markerLength] === marker) {
    markerLength += 1;
  }
  if (markerLength < 3) {
    return null;
  }

  const infoRaw = text.slice(index + markerLength);
  if (marker === '`' && infoRaw.includes('`')) {
    return null;
  }

  return {
    markerIndex: index,
    marker,
    markerLength,
    info: infoRaw.trim(),
    quoteDepth,
    contentColumn: index - quotePrefixLength,
  };
}

function stripQuoteDepth(text: string, depth: number): string | null {
  if (depth === 0) {
    return text;
  }
  let index = 0;
  for (let seen = 0; seen < depth; seen += 1) {
    const next = consumeBlockquoteMarker(text, index);
    if (next === index) {
      return null;
    }
    index = next;
  }
  return text.slice(index);
}

function isClosingFence(text: string, marker: '`' | '~', markerLength: number): boolean {
  let index = 0;
  let indent = 0;
  while (indent < 3 && text[index] === ' ') {
    indent += 1;
    index += 1;
  }
  if (text[index] !== marker) {
    return false;
  }
  let length = 0;
  while (text[index + length] === marker) {
    length += 1;
  }
  if (length < markerLength) {
    return false;
  }
  return text.slice(index + length).trim() === '';
}

function stripContentIndent(text: string, column: number): string {
  let index = 0;
  let stripped = 0;
  while (stripped < column && text[index] === ' ') {
    index += 1;
    stripped += 1;
  }
  return text.slice(index);
}

/**
 * Index every CommonMark fenced code block in `markdown`.
 * `startOffset` is the first fence marker (` or ~), matching Streamdown.
 */
export function indexArtifactFences(markdown: string): ArtifactFenceRecord[] {
  const lines = splitMarkdownLines(markdown);
  const fences: ArtifactFenceRecord[] = [];
  let lineIndex = 0;
  let ordinal = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (!line) {
      break;
    }
    const opening = parseOpeningFence(line.text);
    if (!opening) {
      lineIndex += 1;
      continue;
    }

    const contentLines: string[] = [];
    let cursor = lineIndex + 1;
    let open = true;
    let endOffset: number | null = null;

    while (cursor < lines.length) {
      const current = lines[cursor];
      if (!current) {
        break;
      }
      const rest = stripQuoteDepth(current.text, opening.quoteDepth);
      if (rest === null) {
        open = false;
        endOffset = current.start;
        break;
      }
      if (isClosingFence(rest, opening.marker, opening.markerLength)) {
        open = false;
        endOffset = current.start + current.text.length + current.newlineLength;
        cursor += 1;
        break;
      }
      contentLines.push(stripContentIndent(rest, opening.contentColumn));
      cursor += 1;
    }

    fences.push({
      ordinal,
      startOffset: line.start + opening.markerIndex,
      endOffset: open ? null : endOffset,
      info: opening.info,
      language: getFenceLanguageToken(opening.info),
      source: contentLines.join('\n'),
      open,
    });
    ordinal += 1;
    if (open) {
      break;
    }
    lineIndex = cursor;
  }

  return fences;
}
