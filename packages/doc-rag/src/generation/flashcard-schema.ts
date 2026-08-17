import type { ContextPack, GeneratedFlashcard, KnowledgePoint } from '@piwin/contracts';
import { fallbackPackSourceId, resolveSourceIds } from './resolve-source-ids.js';

export const GENERATED_FLASHCARD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['front', 'back', 'cardType', 'knowledgePointIds', 'sourceChunkIds'],
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          cardType: { type: 'string' },
          relationFromPrevious: { type: 'string' },
          knowledgePointIds: { type: 'array', items: { type: 'string' } },
          sourceChunkIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export function parseGeneratedFlashcards(
  value: unknown,
  pack: ContextPack,
  knowledgePoints: KnowledgePoint[],
): GeneratedFlashcard[] {
  const record = asRecord(value);
  const list = record?.cards ?? (Array.isArray(value) ? value : undefined);
  if (!Array.isArray(list)) return [];
  const packIds = new Set(pack.sources.map((source) => source.chunkId));
  const kpById = new Map(knowledgePoints.map((kp) => [kp.id, kp]));
  const cards: GeneratedFlashcard[] = [];
  for (const item of list) {
    const raw = asRecord(item);
    if (!raw) continue;
    const front = typeof raw.front === 'string' ? raw.front.trim() : '';
    const back = typeof raw.back === 'string' ? raw.back.trim() : '';
    if (!front || !back) continue;
    const knowledgePointIds = asStringArray(raw.knowledgePointIds).filter((id) => kpById.has(id));
    const allowedChunks = new Set(
      knowledgePointIds.flatMap((id) => kpById.get(id)?.sourceChunkIds ?? []),
    );
    const sourceChunkIds = resolveSourceIds(asStringArray(raw.sourceChunkIds), pack).filter(
      (id) => packIds.has(id) && (allowedChunks.size === 0 || allowedChunks.has(id)),
    );
    if (sourceChunkIds.length === 0) {
      const fromKp = knowledgePointIds
        .flatMap((id) => kpById.get(id)?.sourceChunkIds ?? [])
        .find((id) => packIds.has(id));
      if (fromKp) sourceChunkIds.push(fromKp);
    }
    const packFallback = fallbackPackSourceId(pack);
    if (sourceChunkIds.length === 0 && packFallback && packIds.has(packFallback)) {
      sourceChunkIds.push(packFallback);
    }
    if (sourceChunkIds.length === 0) continue;
    const next: GeneratedFlashcard = {
      position: cards.length + 1,
      front,
      back,
      cardType: typeof raw.cardType === 'string' && raw.cardType.trim() ? raw.cardType.trim() : 'fact',
      knowledgePointIds,
      sourceChunkIds,
    };
    if (cards.length > 0 && typeof raw.relationFromPrevious === 'string' && raw.relationFromPrevious.trim()) {
      next.relationFromPrevious = raw.relationFromPrevious.trim();
    }
    cards.push(next);
  }
  return cards;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
