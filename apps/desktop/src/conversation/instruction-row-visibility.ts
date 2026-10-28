import type { ChatMessageUi } from './chat-reducer.js';

/**
 * User instruction rows the transcript keeps in state (for reload and
 * reconciliation) but does not draw:
 * - pending/starting queued turns already have a queue chip above the composer;
 * - cancelled interventions and queued turns were withdrawn before reaching
 *   the model, so they are not part of the conversation.
 */
export function isInstructionRowHiddenFromTranscript(message: ChatMessageUi): boolean {
  const delivery = message.instructionDelivery;
  if (!delivery) return false;
  if (delivery.status === 'cancelled') return true;
  return (
    delivery.kind === 'queued-turn' &&
    (delivery.status === 'pending' || delivery.status === 'starting')
  );
}
