/**
 * Same-message text + work tools is process body: still markdown, but it is
 * not the settled conclusion used for copy/fold. The conclusion is a later
 * assistant row without work tools.
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

/**
 * Generated media and image/video tools stay in the visible reply, not behind work fold.
 *
 * A media attachment counts only when no work tool sits on the same row: a
 * `browser_screenshot` also attaches `source: generated` media, but that image
 * is process evidence. Treating it as a deliverable made every browser-driving
 * turn look answered mid-chain, so the turn never folded.
 */
export function assistantHasUserFacingGeneration(message: ChatMessageUi): boolean {
  if (message.tools.some((tool) => resolveGenerationToolKind(tool) !== null)) {
    return true;
  }
  return (
    message.attachments.some((attachment) => attachment.kind === 'media') &&
    !assistantHasWorkTools(message)
  );
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
