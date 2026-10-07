import { createContext, useContext, type ReactElement } from 'react';
import { Block, parseMarkdownIntoBlocks, type BlockProps } from 'streamdown';

/**
 * Link reference definitions (and footnotes, which share the shape) resolve
 * across the whole document. A block parsed alone cannot see a definition
 * that lives in another block, so such a reply stays one document.
 */
const CROSS_BLOCK_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S/m;

type MarkdownBlockGeneration = {
  markdown: string;
  blocks: string[];
  startOffsets: number[];
};

export type MarkdownBlockIndex = {
  /** `parseMarkdownIntoBlocksFn` for Streamdown; identity is stable. */
  parse: (markdown: string) => string[];
  /** Offset of a rendered block in the markdown it was split from. */
  startOffsetOf: (index: number, content: string) => number;
};

function splitMarkdownIntoBlocks(markdown: string): string[] {
  if (CROSS_BLOCK_DEFINITION.test(markdown)) {
    return [markdown];
  }
  return parseMarkdownIntoBlocks(markdown);
}

function locateBlocks(markdown: string, blocks: readonly string[]): number[] {
  const startOffsets: number[] = [];
  let cursor = 0;
  for (const block of blocks) {
    // Blocks are slices of the source in order. Searching (rather than summing
    // lengths) survives a splitter that drops separators between them.
    const found = block.length > 0 ? markdown.indexOf(block, cursor) : -1;
    const start = found >= 0 ? found : cursor;
    startOffsets.push(start);
    cursor = start + block.length;
  }
  return startOffsets;
}

/**
 * Splits a streaming reply into blocks and remembers where each one starts.
 *
 * Streamdown memoizes a block on its text, so a token re-parses only the block
 * it lands in — but it also parses each block alone, which makes every
 * `node.position` block-relative. Artifact fences are identified by their
 * offset in the whole reply, so the offset of the block is kept here and added
 * back by the fence renderer.
 *
 * Two generations are kept: Streamdown renders the previous split for one
 * commit after a new one is computed, and a block must resolve against the
 * split it actually came from.
 */
export function createMarkdownBlockIndex(): MarkdownBlockIndex {
  let latest: MarkdownBlockGeneration | null = null;
  let previous: MarkdownBlockGeneration | null = null;
  return {
    parse(markdown) {
      if (latest !== null && latest.markdown === markdown) {
        return latest.blocks;
      }
      const blocks = splitMarkdownIntoBlocks(markdown);
      previous = latest;
      latest = { markdown, blocks, startOffsets: locateBlocks(markdown, blocks) };
      return blocks;
    },
    startOffsetOf(index, content) {
      for (const generation of [latest, previous]) {
        if (generation !== null && generation.blocks[index] === content) {
          return generation.startOffsets[index] ?? 0;
        }
      }
      return latest?.startOffsets[index] ?? 0;
    },
  };
}

const MarkdownBlockIndexContext = createContext<MarkdownBlockIndex | null>(null);
const MarkdownBlockStartOffsetContext = createContext(0);

export const MarkdownBlockIndexProvider = MarkdownBlockIndexContext.Provider;

/** Start of the enclosing block in the reply; 0 when the reply is one document. */
export function useMarkdownBlockStartOffset(): number {
  return useContext(MarkdownBlockStartOffsetContext);
}

/** Streamdown `BlockComponent`: the stock block, plus where it sits in the reply. */
export function MarkdownStreamBlock(props: BlockProps): ReactElement {
  const blockIndex = useContext(MarkdownBlockIndexContext);
  const startOffset =
    blockIndex === null || typeof props.content !== 'string'
      ? 0
      : blockIndex.startOffsetOf(props.index, props.content);
  return (
    <MarkdownBlockStartOffsetContext.Provider value={startOffset}>
      <Block {...props} />
    </MarkdownBlockStartOffsetContext.Provider>
  );
}
