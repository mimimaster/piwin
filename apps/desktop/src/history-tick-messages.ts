import type { SessionUserMessageAnchor, SessionUserMessageIndexData } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer.js';

export type HistoryTickMessage = {
  id: string;
  text: string;
  createdAt?: string;
  anchor?: SessionUserMessageAnchor;
};

/** Retain the Host-wide rail while adding newly sent, not-yet-indexed turns. */
export function buildHistoryTickMessages(
  messages: readonly ChatMessageUi[],
  index: SessionUserMessageIndexData | null,
): HistoryTickMessage[] {
  const local = messages.filter(
    (message) => message.role === 'user' && message.text.trim().length > 0,
  );
  if (!index) return local.map(toLocalTick);
  const ticks: HistoryTickMessage[] = index.anchors.map((anchor) => ({
    id: anchor.messageId,
    text: anchor.preview,
    createdAt: anchor.createdAt,
    anchor,
  }));
  const indexedIds = new Set(ticks.map((tick) => tick.id));
  const lastIndexedTime = ticks.at(-1)?.createdAt;
  // Sampled indexes intentionally omit interior rows. Only append the newer
  // local tail, never backfill their gaps from a temporary history window.
  for (const message of local) {
    if (indexedIds.has(message.id)) continue;
    if (lastIndexedTime && (!message.createdAt || message.createdAt < lastIndexedTime)) continue;
    ticks.push(toLocalTick(message));
  }
  return ticks;
}

function toLocalTick(message: ChatMessageUi): HistoryTickMessage {
  return {
    id: message.id,
    text: message.text,
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  };
}
