import type { ChatMessageUi } from './chat-reducer.js';

/**
 * Host-owned next-turn queue rows stay off the transcript until they start.
 * Pending/starting follow-ups already have a queue chip above the composer.
 */
export function isQueuedTurnHiddenFromTranscript(message: ChatMessageUi): boolean {
  const delivery = message.instructionDelivery;
  return (
    delivery?.kind === 'queued-turn' &&
    (delivery.status === 'pending' || delivery.status === 'starting')
  );
}
