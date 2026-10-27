import type {
  SessionUserMessageAnchor,
  SessionUserMessageIndexData,
  SessionUserMessageTurnMark,
} from '@piwin/contracts';
import type { ChatMessageUi } from '../conversation/chat-reducer.js';
import { isIndexedUserMessage } from '../conversation/indexed-user-message.js';

export type HistoryTickMessage = {
  id: string;
  text: string;
  createdAt?: string;
  anchor?: SessionUserMessageAnchor;
  /** Turn ordinal in the whole session (Host index ordinals). */
  ordinal: number;
  /** Inclusive turn span this tick stands for (a sampled anchor covers several). */
  spanStartOrdinal: number;
  spanEndOrdinal: number;
  marks: readonly SessionUserMessageTurnMark[];
};

const NO_MARKS: readonly SessionUserMessageTurnMark[] = [];

/** Retain the Host-wide rail while adding newly sent, not-yet-indexed turns. */
export function buildHistoryTickMessages(
  messages: readonly ChatMessageUi[],
  index: SessionUserMessageIndexData | null,
): HistoryTickMessage[] {
  const local = messages.filter(isIndexedUserMessage);
  if (!index) return local.map((message, position) => toLocalTick(message, position));
  const ticks: HistoryTickMessage[] = index.anchors.map((anchor) => ({
    id: anchor.messageId,
    text: anchor.preview,
    createdAt: anchor.createdAt,
    anchor,
    ordinal: anchor.ordinal,
    spanStartOrdinal: anchor.spanStartOrdinal,
    spanEndOrdinal: anchor.spanEndOrdinal,
    marks: anchor.marks ?? NO_MARKS,
  }));
  const indexedIds = new Set(ticks.map((tick) => tick.id));
  const lastIndexedTime = ticks.at(-1)?.createdAt;
  let nextOrdinal = (ticks.at(-1)?.spanEndOrdinal ?? -1) + 1;
  // Sampled indexes intentionally omit interior rows. Only append the newer
  // local tail, never backfill their gaps from a temporary history window.
  for (const message of local) {
    if (indexedIds.has(message.id)) continue;
    if (lastIndexedTime && (!message.createdAt || message.createdAt < lastIndexedTime)) continue;
    ticks.push(toLocalTick(message, nextOrdinal));
    nextOrdinal += 1;
  }
  return ticks;
}

/** Turns the rail covers: the Host total, or more once new sends are appended. */
export function countHistoryTickTurns(
  ticks: readonly HistoryTickMessage[],
  index: SessionUserMessageIndexData | null,
): number {
  return Math.max(index?.totalUserMessages ?? 0, (ticks.at(-1)?.spanEndOrdinal ?? -1) + 1);
}

function toLocalTick(message: ChatMessageUi, ordinal: number): HistoryTickMessage {
  return {
    id: message.id,
    text: message.text,
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ordinal,
    spanStartOrdinal: ordinal,
    spanEndOrdinal: ordinal,
    marks: NO_MARKS,
  };
}
