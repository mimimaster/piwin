/**
 * Raw Markdown → Streamdown input. Canonical fence records stay on raw offsets;
 * synthetic closers and the native stream marker are render-only.
 */
import {
  indexArtifactFences,
  type ArtifactFenceRecord,
} from './fence-index.js';
import {
  STREAMING_ARTIFACT_FENCE_MARKER,
  isNativeArtifactLanguage,
  isProjectableStreamingFence,
} from './fence-syntax.js';

export type ArtifactMarkdownProjection = {
  markdown: string;
  fences: readonly ArtifactFenceRecord[];
  ordinalByProjectedStartOffset: ReadonlyMap<number, number>;
};

function lineStartOffset(markdown: string, offset: number): number {
  const previousNewline = markdown.lastIndexOf('\n', offset - 1);
  return previousNewline === -1 ? 0 : previousNewline + 1;
}

function openingLineInsertOffset(markdown: string, startOffset: number): number {
  const newline = markdown.indexOf('\n', startOffset);
  if (newline === -1) {
    return markdown.length;
  }
  if (newline > 0 && markdown[newline - 1] === '\r') {
    return newline - 1;
  }
  return newline;
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

function blockquotePrefixBeforeFence(markdown: string, startOffset: number): string {
  const prefix = markdown.slice(lineStartOffset(markdown, startOffset), startOffset);
  let index = 0;
  while (index < prefix.length) {
    const next = consumeBlockquoteMarker(prefix, index);
    if (next === index) {
      break;
    }
    index = next;
  }
  return prefix.slice(0, index);
}

function fenceMarkerRun(
  markdown: string,
  startOffset: number,
): { char: '`' | '~'; length: number } {
  const char = markdown[startOffset] === '~' ? '~' : '`';
  let length = 0;
  while (markdown[startOffset + length] === char) {
    length += 1;
  }
  return { char, length: Math.max(length, 3) };
}

function buildOrdinalMap(
  fences: readonly ArtifactFenceRecord[],
  insertions: readonly { offset: number; text: string }[],
): Map<number, number> {
  const map = new Map<number, number>();
  let insertionIndex = 0;
  let shift = 0;
  for (const fence of fences) {
    let insertion = insertions[insertionIndex];
    while (insertion && insertion.offset <= fence.startOffset) {
      shift += insertion.text.length;
      insertion = insertions[++insertionIndex];
    }
    map.set(fence.startOffset + shift, fence.ordinal);
  }
  return map;
}

/**
 * Prepare Streamdown input from raw Markdown. When `done` is false, an open
 * native/explicit fence gets a synthetic closer (blockquote-prefixed when
 * needed) and native fences also get STREAMING_ARTIFACT_FENCE_MARKER.
 */
export function projectArtifactMarkdownForRender(
  rawMarkdown: string,
  done: boolean,
): ArtifactMarkdownProjection {
  const fences = indexArtifactFences(rawMarkdown);
  const insertions = fences.flatMap((fence) => fence.recoveredOpening
    ? [{ offset: fence.startOffset, text: '\n\n' }] : []);
  const openFence = done ? undefined : fences.find((fence) => fence.open && isProjectableStreamingFence(fence.info));

  if (openFence && isNativeArtifactLanguage(openFence.info)) {
    const insertAt = openingLineInsertOffset(rawMarkdown, openFence.startOffset);
    const openingLine = rawMarkdown.slice(
      lineStartOffset(rawMarkdown, openFence.startOffset),
      insertAt,
    );
    if (!openingLine.includes(STREAMING_ARTIFACT_FENCE_MARKER)) {
      const insertion = ` ${STREAMING_ARTIFACT_FENCE_MARKER}`;
      insertions.push({ offset: insertAt, text: insertion });
    }
  }

  // Index order is ascending; the optional open-fence marker comes last.
  // Assemble once, keeping raw offsets intact even for many artifacts.
  const parts: string[] = [];
  let copiedTo = 0;
  for (const insertion of insertions) {
    parts.push(rawMarkdown.slice(copiedTo, insertion.offset), insertion.text);
    copiedTo = insertion.offset;
  }
  parts.push(rawMarkdown.slice(copiedTo));
  let markdown = parts.join('');
  if (openFence) {
    const { char, length } = fenceMarkerRun(rawMarkdown, openFence.startOffset);
    const prefix = blockquotePrefixBeforeFence(rawMarkdown, openFence.startOffset);
    const closer = `${prefix}${char.repeat(length)}`;
    markdown = markdown.endsWith('\n') || markdown.endsWith('\r')
      ? `${markdown}${closer}`
      : `${markdown}\n${closer}`;
  }

  return {
    markdown,
    fences,
    ordinalByProjectedStartOffset: buildOrdinalMap(fences, insertions),
  };
}
