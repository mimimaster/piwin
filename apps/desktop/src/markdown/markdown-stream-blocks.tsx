import { createContext, memo, useContext, type ComponentType, type ReactElement } from 'react';
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

const MarkdownBlockStartOffsetContext = createContext(0);

/** Start of the enclosing block in the reply; 0 when the reply is one document. */
export function useMarkdownBlockStartOffset(): number {
  return useContext(MarkdownBlockStartOffsetContext);
}

function sameComponentMap(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  if (typeof previous !== 'object' || typeof next !== 'object' || !previous || !next) return false;
  const previousMap = previous as Record<string, unknown>;
  const nextMap = next as Record<string, unknown>;
  const keys = Object.keys(previousMap);
  return (
    keys.length === Object.keys(nextMap).length &&
    keys.every((key) => previousMap[key] === nextMap[key])
  );
}

/**
 * Every prop by identity, `components` by its entries. At least as strict as
 * the comparator on Streamdown's own `Block`, so a block that would re-parse
 * there still re-renders here; props a later Streamdown adds count by default.
 */
function sameBlockProps(previous: BlockProps, next: BlockProps): boolean {
  const previousProps = previous as unknown as Record<string, unknown>;
  const nextProps = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousProps), ...Object.keys(nextProps)]);
  for (const key of keys) {
    if (Object.is(previousProps[key], nextProps[key])) continue;
    if (key === 'components' && sameComponentMap(previousProps[key], nextProps[key])) continue;
    return false;
  }
  return true;
}

/**
 * Streamdown `BlockComponent` for one mounted reply: the stock block, plus
 * where it sits in the reply.
 *
 * Streamdown renders its whole block list twice per token and the stock block
 * only bails out below this wrapper, so an unmemoized wrapper costs two
 * renders per block per token — the dominant cost of a long streaming reply.
 * The memo cannot rely on props alone: a block keeps its text and position
 * while an edit above it moves its offset, so the comparator also checks the
 * offset the block last rendered with against the current split.
 */
export function createMarkdownStreamBlock(blockIndex: MarkdownBlockIndex): ComponentType<BlockProps> {
  const renderedStartOffsets = new Map<number, number>();

  function startOffsetFor(props: BlockProps): number {
    return typeof props.content === 'string'
      ? blockIndex.startOffsetOf(props.index, props.content)
      : 0;
  }

  function MarkdownStreamBlock(props: BlockProps): ReactElement {
    const startOffset = startOffsetFor(props);
    // Read back by the comparator; rewriting the same value on a replayed
    // render is harmless.
    renderedStartOffsets.set(props.index, startOffset);
    return (
      <MarkdownBlockStartOffsetContext.Provider value={startOffset}>
        <Block {...props} />
      </MarkdownBlockStartOffsetContext.Provider>
    );
  }

  return memo(
    MarkdownStreamBlock,
    (previous, next) =>
      sameBlockProps(previous, next) &&
      renderedStartOffsets.get(next.index) === startOffsetFor(next),
  );
}
