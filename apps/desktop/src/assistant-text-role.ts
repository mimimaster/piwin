/**
 * Whether an assistant `text` part is a user-facing reply or a tool-loop
 * caption. Same-message text + work tools are generated before those tools
 * run, so the caption cannot be the answer that uses the results.
 */
import type { ChatMessageUi, ToolCardUi } from './chat-reducer.js';
import { resolveGenerationToolKind } from './generation-tool-kind.js';

export type AssistantTextRole = 'reply' | 'process';

function toolLooksLikeFlashcardCreate(tool: ToolCardUi): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName, tool.presentation?.title]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());
  return names.some(
    (name) => name.includes('flashcard_create') || name.includes('flashcard_batch_create'),
  );
}

function isUserFacingResultTool(tool: ToolCardUi): boolean {
  return resolveGenerationToolKind(tool) !== null || toolLooksLikeFlashcardCreate(tool);
}

export function assistantHasWorkTools(message: ChatMessageUi): boolean {
  return message.tools.some((tool) => !isUserFacingResultTool(tool));
}

export function assistantTextRole(message: ChatMessageUi): AssistantTextRole {
  if (message.role !== 'assistant') {
    return 'reply';
  }
  return assistantHasWorkTools(message) ? 'process' : 'reply';
}

export function assistantTextIsProcess(message: ChatMessageUi): boolean {
  return assistantTextRole(message) === 'process';
}
