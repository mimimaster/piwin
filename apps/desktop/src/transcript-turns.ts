import { mergeSearchEvidence } from '@piwin/contracts';
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
  /** Visible response row that owns the aggregated Run presentation. */
  ownerMessageId: string;
  /** Assistant lifecycle rows represented by this one presentation. */
  memberMessageIds: readonly string[];
  /** Aggregated message used by the response row and TurnWorkDetails. */
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
 * Product work details and answer chrome belong to the run, not to each Pi
 * model/tool-loop lifecycle message. Collapse messages sharing a runId into
 * one presentation so progress narration does not masquerade as several
 * independent answers.
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
    // Prefer the last body segment as owner so TurnWorkDetails (tools/thinking)
    // sits immediately above the visible answer in the same bubble — not above a
    // pile of empty lifecycle rows while the reply streams further down.
    const bodyMessages = messages.filter((message) => message.text.trim().length > 0);
    const lastBodyMessage = bodyMessages[bodyMessages.length - 1];
    const ownerMessage = lastBodyMessage ?? lastMessage;
    const attachmentsById = new Map<string, ChatMessageUi['attachments'][number]>();
    let searchEvidence: ChatMessageUi['searchEvidence'];
    for (const message of messages) {
      for (const attachment of message.attachments) {
        attachmentsById.set(attachment.id, attachment);
      }
      if (message.searchEvidence !== undefined) {
        searchEvidence = mergeSearchEvidence(searchEvidence, message.searchEvidence);
      }
    }
    const status = messages.some((message) => message.status === 'streaming')
      ? 'streaming'
      : lastMessage.status;

    projections.push({
      ownerMessageId: ownerMessage.id,
      memberMessageIds: messages.map((message) => message.id),
      message: {
        ...ownerMessage,
        // Only the latest response body is answer text. Earlier bodies belong
        // to tool-use lifecycle segments and stay durable without being
        // repeated as separate Markdown answers.
        text: ownerMessage.text,
        thinking,
        tools: [...toolsById.values()],
        attachments: [...attachmentsById.values()],
        status,
        ...(searchEvidence !== undefined ? { searchEvidence } : {}),
      },
    });
  }
  return projections;
}
