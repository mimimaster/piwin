import type { ArtifactFenceRecord } from '@piwin/artifact';

/**
 * Bind a Streamdown fenced `code` node to the canonical Artifact fence index.
 *
 * Primary key is `node.position.start.offset` on the projected markdown.
 * Streamdown 2.5 can report a block-relative 0 (or drop offset) even when
 * `parseMarkdownIntoBlocksFn` keeps one document; fall back to a unique
 * language match so a lone `artifact-html` fence still materializes.
 */
export function lookupIndexedFence(input: {
  fences: readonly ArtifactFenceRecord[];
  ordinalByProjectedStartOffset: ReadonlyMap<number, number>;
  startOffset: number | undefined;
  language: string;
}): ArtifactFenceRecord | null {
  if (typeof input.startOffset === 'number') {
    const ordinal = input.ordinalByProjectedStartOffset.get(input.startOffset);
    if (ordinal !== undefined) {
      return input.fences.find((fence) => fence.ordinal === ordinal) ?? null;
    }
  }

  const language = input.language.trim().toLowerCase();
  if (language) {
    const matching = input.fences.filter((fence) => fence.language.toLowerCase() === language);
    if (matching.length === 1) {
      return matching[0] ?? null;
    }
  }

  return input.fences.length === 1 ? (input.fences[0] ?? null) : null;
}
