/**
 * Conversation turn chrome: one identity header per user turn, not per
 * model completion. Tool-loop assistant rows stay in the transcript and
 * Conversation paints their tools (search, fetch, artifact, toolbox).
 */
import { isFlashcardCreateToolName } from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';

export type ConversationTurnChrome = {
  /** First assistant row Conversation will actually paint; owns the identity header. */
  identityMessageId: string | null;
  hiddenAssistantIds: ReadonlySet<string>;
  /** Turn usage belongs on the identity header of the session's latest turn. */
  showUsageOnIdentity: boolean;
};

/**
 * Content Conversation paints besides thinking / identity. Tool-loop captions
 * still leave the row visible because the tools themselves count; the caption
 * is not a reply (see assistantTextRole). Conversation's model-visible surface
 * is small (search, fetch, artifact instructions, toolbox).
 */
export function conversationAssistantHasVisibleBody(message: ChatMessageUi): boolean {
  if (message.text.trim().length > 0) {
    return true;
  }
  if (message.attachments.length > 0) {
    return true;
  }
  if ((message.searchEvidence?.citations.length ?? 0) > 0) {
    return true;
  }
  if (message.tools.length > 0) {
    return true;
  }
  return false;
}

export function shouldHideConversationAssistantRow(input: {
  message: ChatMessageUi;
  isLastAssistantInTurn: boolean;
  isActivelyStreaming: boolean;
}): boolean {
  const { message } = input;
  if (message.role !== 'assistant') {
    return false;
  }
  if (message.subagentActivity) {
    return true;
  }
  // Failed turns must stay visible even with empty body — TurnErrorCard lives
  // on the assistant row, and Conversation used to hide them as "no reply".
  if (message.status === 'error' || Boolean(message.error)) {
    return false;
  }
  if (input.isActivelyStreaming) {
    return false;
  }
  if (conversationAssistantHasVisibleBody(message)) {
    return false;
  }
  if (input.isLastAssistantInTurn) {
    return message.thinking.trim().length === 0 && !assistantHasFlashcardResult(message);
  }
  return true;
}

function assistantHasFlashcardResult(message: ChatMessageUi): boolean {
  return message.tools.some((tool) => tool.status === 'done' && toolNameLooksLikeFlashcard(tool));
}

function toolNameLooksLikeFlashcard(tool: ToolCardUi): boolean {
  return [tool.toolName, tool.presentation?.routedToolName, tool.presentation?.title].some((name) =>
    isFlashcardCreateToolName(name),
  );
}

export function resolveConversationTurnChrome(input: {
  messages: readonly ChatMessageUi[];
  lastAssistantMessageId: string | null;
  latestAssistantMessageId: string | null;
}): ConversationTurnChrome {
  const hiddenAssistantIds = new Set<string>();
  let identityMessageId: string | null = null;
  const lastAssistantMessageId = input.lastAssistantMessageId;
  const lastAssistant = lastAssistantMessageId
    ? input.messages.find((message) => message.id === lastAssistantMessageId)
    : undefined;
  const showUsageOnIdentity =
    lastAssistantMessageId !== null &&
    lastAssistantMessageId === input.latestAssistantMessageId &&
    lastAssistant?.status === 'done';

  for (const message of input.messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const hide = shouldHideConversationAssistantRow({
      message,
      isLastAssistantInTurn: message.id === lastAssistantMessageId,
      isActivelyStreaming: message.status === 'streaming',
    });
    if (hide) {
      hiddenAssistantIds.add(message.id);
      continue;
    }
    if (identityMessageId === null) {
      identityMessageId = message.id;
    }
  }

  return {
    identityMessageId,
    hiddenAssistantIds,
    showUsageOnIdentity,
  };
}
