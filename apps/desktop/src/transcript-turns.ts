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

export type TranscriptTurnWorkDetails = {
  /** First Assistant row for the run; the work timeline renders before it. */
  ownerMessageId: string;
  /** Run-level projection consumed only by TurnWorkDetails. */
  message: ChatMessageUi;
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

/**
 * Pi emits one Assistant lifecycle message for every model/tool-loop segment.
 * Product work details belong to the run, so collapse messages sharing a
 * runId into one presentation while leaving their user-facing text rows intact.
 */
export function projectTranscriptTurnWorkDetails(
  turn: TranscriptTurn,
): TranscriptTurnWorkDetails[] {
  const groupedMessages = new Map<string, ChatMessageUi[]>();
  for (const { message } of turn.items) {
    if (message.role !== 'assistant' || message.subagentActivity !== undefined) continue;
    const groupKey = message.runId ? `run:${message.runId}` : `message:${message.id}`;
    const existing = groupedMessages.get(groupKey);
    if (existing) {
      existing.push(message);
    } else {
      groupedMessages.set(groupKey, [message]);
    }
  }

  const projections: TranscriptTurnWorkDetails[] = [];
  for (const messages of groupedMessages.values()) {
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    if (!firstMessage || !lastMessage) continue;

    const toolsById = new Map<string, ChatMessageUi['tools'][number]>();
    for (const message of messages) {
      for (const tool of message.tools) {
        toolsById.set(tool.toolCallId, tool);
      }
    }
    const thinking = messages
      .map((message) => message.thinking.trim())
      .filter((value) => value.length > 0)
      .join('\n\n');
    const firstVisibleText = messages.find((message) => message.text.trim().length > 0)?.text ?? '';
    const status = messages.some((message) => message.status === 'streaming')
      ? 'streaming'
      : lastMessage.status;

    projections.push({
      ownerMessageId: firstMessage.id,
      message: {
        ...firstMessage,
        text: firstVisibleText,
        thinking,
        tools: [...toolsById.values()],
        attachments: [],
        status,
      },
    });
  }
  return projections;
}
