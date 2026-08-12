import type { ChatMessageUi } from './chat-reducer';

export type TranscriptTurnItem = {
  message: ChatMessageUi;
  messageIndex: number;
};

export type TranscriptTurn = {
  id: string;
  items: TranscriptTurnItem[];
  lastAssistantMessageId: string | null;
};

/**
 * Group one user prompt and its following assistant activity into a render unit.
 * Turn-level units keep virtualization from splitting coupled work details and
 * the final assistant response across independent measurement boundaries.
 */
export function groupTranscriptTurns(messages: readonly ChatMessageUi[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let currentTurn: TranscriptTurn | null = null;

  messages.forEach((message, messageIndex) => {
    if (message.role === 'user' || currentTurn === null) {
      currentTurn = {
        id: `turn-${message.id}`,
        items: [],
        lastAssistantMessageId: null,
      };
      turns.push(currentTurn);
    }

    currentTurn.items.push({ message, messageIndex });
    if (message.role === 'assistant') {
      currentTurn.lastAssistantMessageId = message.id;
    }
  });

  return turns;
}

export function indexTranscriptTurnsByMessageId(
  turns: readonly TranscriptTurn[],
): ReadonlyMap<string, number> {
  const indexByMessageId = new Map<string, number>();
  turns.forEach((turn, turnIndex) => {
    for (const item of turn.items) {
      indexByMessageId.set(item.message.id, turnIndex);
    }
  });
  return indexByMessageId;
}
