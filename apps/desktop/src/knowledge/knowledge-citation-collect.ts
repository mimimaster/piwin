import { readKnowledgeToolDetails, type KnowledgeCitation } from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from '../chat-reducer';
import { getMessageTools } from '../flashcard-result-extract.js';
import {
  EMPTY_KNOWLEDGE_CITATION_INDEX,
  type KnowledgeCitationIndex,
} from './knowledge-citations.js';

/** Citations from completed knowledge tools, lifted by the Host into `presentation.knowledge`. */
export function collectKnowledgeCitations(
  message: ChatMessageUi,
  extraTools?: readonly ToolCardUi[],
): KnowledgeCitationIndex {
  let index: Map<number, KnowledgeCitation> | null = null;
  for (const tool of getMessageTools(message, extraTools)) {
    if (tool.status !== 'done') continue;
    const details = readKnowledgeToolDetails(tool.presentation?.knowledge);
    if (!details) continue;
    for (const citation of details.citations) {
      index ??= new Map();
      // Refs are unique per run; the first result that used a ref owns it.
      if (!index.has(citation.ref)) index.set(citation.ref, citation);
    }
  }
  return index ?? EMPTY_KNOWLEDGE_CITATION_INDEX;
}
