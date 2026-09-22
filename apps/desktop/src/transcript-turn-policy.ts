import { defaultRangeExtractor, type Range, type VirtualItem } from '@tanstack/react-virtual';
import type { TranscriptTurn } from './transcript-turns.js';

/** Virtualize any non-empty transcript. Off-screen history must not mount. */
export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 0;
export const TRANSCRIPT_TURN_GAP_PX = 20;
/**
 * Keep enough off-screen turns mounted that first-measure (estimate → actual)
 * happens above the fold. Overscan 2 let rows appear, remasure, then jump.
 */
export const TRANSCRIPT_TURN_OVERSCAN = 8;
/** Always keep the newest N items/turns mounted so the live call chain never unmounts. */
export const TRANSCRIPT_LIVE_TAIL_PIN_COUNT = 3;

/**
 * WKWebView starves `requestAnimationFrame` under a steady Host stream — the
 * same trap Streamdown's `startTransition` path hit. TanStack's default
 * ResizeObserver → rAF measure therefore never runs while tokens (or a
 * pause/error row) change height, so the next turn is placed on top of the
 * previous markdown.
 *
 * Slot height is locked to the virtualizer size cache (see render); measure the
 * inner body, not the locked outer shell.
 */
export function transcriptVirtualizerMeasurePolicy(): {
  useAnimationFrameWithResizeObserver: false;
  useFlushSync: true;
} {
  return {
    useAnimationFrameWithResizeObserver: false,
    // Scroll offsets move before React's deferred render. Commit the new range
    // in the scroll event even for idle sessions, or fast history scrolls can
    // paint an empty viewport until React catches up.
    useFlushSync: true,
  };
}

type TranscriptVirtualizerScrollState = {
  scrollDirection: 'forward' | 'backward' | null;
  scrollAdjustments: number;
  scrollOffset: number | null;
  itemSizeCache: ReadonlyMap<string | number | bigint, number>;
};

/**
 * Pin-to-end is `notifyContentGrew` only. This predicate keeps the row the
 * user is reading still — it must not restick the live tail.
 *
 * First measure (estimate → actual) of a row that was fully above the fold
 * must shift scrollTop even while scrolling into history. Skipping that is
 * the “pull-up chat jumps / refreshes” bug. A spanning / just-entering row
 * is left alone so a near-tail flick is not yanked back.
 */
export function shouldAdjustTranscriptScrollOnItemSizeChange(
  item: Pick<VirtualItem, 'key' | 'start' | 'size'>,
  _delta: number,
  instance: TranscriptVirtualizerScrollState,
  following: boolean,
): boolean {
  const scrollOffset = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  const isFirstMeasure = !instance.itemSizeCache.has(item.key);
  const previousEnd = item.start + item.size;
  if (isFirstMeasure) {
    if (following) {
      return item.start < scrollOffset;
    }
    return previousEnd <= scrollOffset;
  }
  // A row entirely above the fold that re-measures (a long reply whose
  // markdown finishes rendering after its first measure) pushes the reader by
  // exactly its delta, whichever way they scroll. Skipping backward re-measures
  // dropped that growth while reading history: a 25k-character reply settling
  // shoved the page ~10k px. Spanning rows still stay put (they grow below
  // the reader's line).
  return previousEnd <= scrollOffset;
}

function transcriptTurnItemStructureKey(turn: TranscriptTurn): string {
  return turn.items
    .map((item) => {
      const message = item.message;
      const toolSig =
        message.tools?.map((tool) => `${tool.toolCallId}:${tool.status}`).join(',') ?? '';
      const failureCode = message.failure?.code ?? '';
      const errorSig = message.error ?? '';
      // Structure only — token growth is handled by buildTranscriptStreamingMeasureKey.
      return [message.id, message.status, toolSig, errorSig, failureCode].join(':');
    })
    .join(';');
}

/** Identity of mounted turn bodies so a pause/error/new-query remasures before paint. */
export function buildTranscriptTurnsStructureKey(turns: readonly TranscriptTurn[]): string {
  return turns
    .map((turn) => `${turn.id}:${turn.items.length}:${transcriptTurnItemStructureKey(turn)}`)
    .join('|');
}

/**
 * Live-tail content fingerprint. Includes text length so streaming growth
 * forces a remasure; structure key alone intentionally does not.
 */
export function buildTranscriptStreamingMeasureKey(
  turns: readonly TranscriptTurn[],
  streaming: boolean,
): string {
  if (!streaming || turns.length === 0) {
    return '';
  }
  const tail = turns.slice(-TRANSCRIPT_LIVE_TAIL_PIN_COUNT);
  return tail
    .map((turn) => {
      const body = turn.items
        .map((item) => {
          const message = item.message;
          const textLen = message.text?.length ?? 0;
          const thinkingLen = message.thinking?.length ?? 0;
          const toolSig =
            message.tools
              ?.map(
                (tool) =>
                  `${tool.toolCallId}:${tool.status}:${(tool.output ?? '').length}`,
              )
              .join(',') ?? '';
          return `${message.id}:${message.status}:${textLen}:${thinkingLen}:${toolSig}`;
        })
        .join(';');
      return `${turn.id}:${body}`;
    })
    .join('|');
}

export function shouldVirtualizeTranscript(turnCount: number): boolean {
  return turnCount > TRANSCRIPT_VIRTUALIZATION_THRESHOLD;
}

export function createTranscriptRangeExtractor(
  pinnedIndex: number | null,
  liveTailStartIndex: number | null = null,
): (range: Range) => number[] {
  return (range) => {
    const indexes = new Set(defaultRangeExtractor(range));
    if (pinnedIndex !== null && pinnedIndex >= 0 && pinnedIndex < range.count) {
      indexes.add(pinnedIndex);
    }
    if (liveTailStartIndex !== null && liveTailStartIndex >= 0) {
      for (let index = liveTailStartIndex; index < range.count; index += 1) {
        indexes.add(index);
      }
    }
    return [...indexes].sort((left, right) => left - right);
  };
}

