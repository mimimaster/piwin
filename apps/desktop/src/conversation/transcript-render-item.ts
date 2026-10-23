/**
 * Flattened Transcript Render Item data structures and transformation pipeline.
 *
 * Flattens nested Turn -> Message -> Tool structures into a 1D list of virtual items:
 * - user-message: User prompt bubble & attachments
 * - tool-group: Clustered tool calls (batch capsules & individual cards)
 * - assistant-message: Assistant thinking & response text (with tools: [] to prevent double-rendering)
 * - subagent-block: Subagent activity cards
 * - system-message: System-level messages
 */
import type { SubagentActivityView } from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';
import type { TranscriptTurn } from './transcript-turns';

export type AssistantMessageRenderData = Omit<ChatMessageUi, 'tools'> & {
  /** Tools are rendered as separate sibling TranscriptRenderItem instances. */
  tools: [];
  /** Reference to the original un-stripped tools for generation status & metadata. */
  originalTools?: readonly ToolCardUi[];
};

export type TranscriptRenderItem =
  | {
      id: string;
      type: 'user-message';
      turnId: string;
      message: ChatMessageUi;
      messageIndex: number;
    }
  | {
      id: string;
      type: 'tool-group';
      turnId: string;
      messageId: string;
      tools: ToolCardUi[];
      messageIndex: number;
    }
  | {
      id: string;
      type: 'assistant-message';
      turnId: string;
      message: AssistantMessageRenderData;
      messageIndex: number;
      isLastAssistantInTurn: boolean;
      isLatestAssistantResponse: boolean;
    }
  | {
      id: string;
      type: 'subagent-block';
      turnId: string;
      messageId: string;
      subagentActivity: SubagentActivityView;
      messageIndex: number;
    }
  | {
      id: string;
      type: 'system-message';
      turnId: string;
      message: ChatMessageUi;
      messageIndex: number;
    };

/**
 * Transforms a list of TranscriptTurns into a 1D array of TranscriptRenderItems.
 * Guarantees that assistant messages have `tools: []` so tools are never double-rendered.
 */
export function flattenTranscriptTurnsToItems(
  turns: readonly TranscriptTurn[],
  options?: {
    latestAssistantMessageId?: string | null;
  },
): TranscriptRenderItem[] {
  const items: TranscriptRenderItem[] = [];
  const latestAssistantId = options?.latestAssistantMessageId ?? null;

  for (const turn of turns) {
    for (let itemIndex = 0; itemIndex < turn.items.length; itemIndex += 1) {
      const turnItem = turn.items[itemIndex];
      if (!turnItem) continue;
      const { message, messageIndex } = turnItem;

      if (message.subagentActivity) {
        items.push({
          id: `subagent-${message.id}`,
          type: 'subagent-block',
          turnId: turn.id,
          messageId: message.id,
          subagentActivity: message.subagentActivity,
          messageIndex,
        });
        continue;
      }

      if (message.role === 'user') {
        items.push({
          id: `user-${message.id}`,
          type: 'user-message',
          turnId: turn.id,
          message,
          messageIndex,
        });
        continue;
      }

      if (message.role === 'system') {
        items.push({
          id: `system-${message.id}`,
          type: 'system-message',
          turnId: turn.id,
          message,
          messageIndex,
        });
        continue;
      }

      if (message.role === 'assistant') {
        // If the assistant message has tool calls, render them as a preceding sibling item
        if (message.tools.length > 0) {
          items.push({
            id: `tools-${message.id}`,
            type: 'tool-group',
            turnId: turn.id,
            messageId: message.id,
            tools: message.tools,
            messageIndex,
          });
        }

        // Assistant response content (thinking, markdown text, actions)
        const strippedMessage: AssistantMessageRenderData = {
          ...message,
          tools: [],
          originalTools: message.tools,
        };

        const isLastAssistantInTurn = turn.lastAssistantMessageId === message.id;
        const isLatestAssistantResponse = latestAssistantId === message.id;

        items.push({
          id: `assistant-${message.id}`,
          type: 'assistant-message',
          turnId: turn.id,
          message: strippedMessage,
          messageIndex,
          isLastAssistantInTurn,
          isLatestAssistantResponse,
        });
      }
    }
  }

  return items;
}

/**
 * Builds a lookup from message ID to item index in the flattened render list.
 * Facilitates fast outline scrolling and pinned message lookup.
 */
export function indexTranscriptRenderItemsByMessageId(
  items: readonly TranscriptRenderItem[],
): ReadonlyMap<string, number> {
  const indexByMessageId = new Map<string, number>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.type === 'user-message' || item.type === 'system-message') {
      indexByMessageId.set(item.message.id, index);
    } else if (item.type === 'assistant-message') {
      indexByMessageId.set(item.message.id, index);
    } else if (item.type === 'tool-group' || item.type === 'subagent-block') {
      indexByMessageId.set(item.messageId, index);
    }
  }

  return indexByMessageId;
}

/**
 * Default height estimates by item type (in pixels).
 */
export const TRANSCRIPT_ITEM_ESTIMATED_HEIGHTS: Record<TranscriptRenderItem['type'], number> = {
  'user-message': 64,
  'tool-group': 44,
  'assistant-message': 140,
  'subagent-block': 96,
  'system-message': 40,
};

export function resolveTranscriptItemEstimate(item: TranscriptRenderItem | undefined): number {
  if (!item) return 80;
  return TRANSCRIPT_ITEM_ESTIMATED_HEIGHTS[item.type] ?? 80;
}
