import type { ContextPack, GeneratedFlashcard, KnowledgePoint } from '@piwin/contracts';
import { assignPositions } from './generation-service.js';

export const DEFAULT_MAX_BATCH_SIZE = 40;

export function qaGeneratedFlashcards(input: {
  cards: GeneratedFlashcard[];
  pack: ContextPack;
  knowledgePoints: KnowledgePoint[];
  existingFronts?: string[];
  maxBatchSize?: number;
}): GeneratedFlashcard[] {
  const packIds = new Set(input.pack.sources.map((source) => source.chunkId));
  const kpById = new Map(input.knowledgePoints.map((kp) => [kp.id, kp]));
  const seenFronts = [...(input.existingFronts ?? [])];
  const accepted: GeneratedFlashcard[] = [];
  for (const card of input.cards) {
    if (accepted.length >= (input.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE)) break;
    const preview = card.model === 'cloze' ? (card.text ?? '') : (card.front ?? '');
    if (card.model === 'cloze') {
      if (!preview.trim() || !/\{\{c\d+::.+\}\}/.test(preview)) continue;
    } else {
      const front = (card.front ?? '').trim();
      const back = (card.back ?? '').trim();
      if (!front || !back) continue;
      if (front.toLowerCase() === back.toLowerCase()) continue;
    }
    if (seenFronts.some((front) => normalize(front) === normalize(preview))) continue;
    const knowledgePointIds = card.knowledgePointIds.filter((id) => kpById.has(id));
    const allowed = new Set(
      knowledgePointIds.flatMap((id) => kpById.get(id)?.sourceChunkIds ?? []),
    );
    const sourceChunkIds = card.sourceChunkIds.filter(
      (id) => packIds.has(id) && (allowed.size === 0 || allowed.has(id)),
    );
    if (sourceChunkIds.length === 0) continue;
    seenFronts.push(preview);
    const next: GeneratedFlashcard = {
      ...card,
      knowledgePointIds,
      sourceChunkIds,
    };
    accepted.push(next);
  }
  return assignPositions(accepted);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
