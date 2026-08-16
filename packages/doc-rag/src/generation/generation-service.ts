import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContextPack, FlashcardCreateInput, GeneratedFlashcard } from '@piwin/contracts';
import { FLASHCARD_QUALITY_RULES } from '../quality-rules.js';

export const SINGLE_PASS_PIPELINE = 'v2-single-llm-legacy';

export type DraftCardsRequest = {
  topic: string;
  workspaceName: string;
  pack: ContextPack;
  existingFronts: string[];
  qualityRules: string;
};

export type DraftCardsFn = (request: DraftCardsRequest) => Promise<GeneratedFlashcard[]>;

export function parseDraftCardsJson(raw: string): GeneratedFlashcard[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) return [];
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) return [];
  const cards: GeneratedFlashcard[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.front !== 'string' || typeof record.back !== 'string') continue;
    if (!record.front.trim() || !record.back.trim()) continue;
    cards.push({
      position: cards.length + 1,
      front: record.front.trim(),
      back: record.back.trim(),
      cardType: typeof record.cardType === 'string' ? record.cardType : 'fact',
      knowledgePointIds: [],
      sourceChunkIds: Array.isArray(record.sourceChunkIds)
        ? record.sourceChunkIds.filter((id): id is string => typeof id === 'string')
        : [],
    });
  }
  return cards;
}

export function buildSinglePassPrompt(request: DraftCardsRequest): string {
  const excerpts = request.pack.sources
    .slice(0, 12)
    .map((source, index) => `[${index + 1}] ${source.relativePath}\n${source.text}`)
    .join('\n\n');
  return [
    `Generate flashcards as a JSON array of { "front", "back", "cardType" }.`,
    `Workspace: ${request.workspaceName}`,
    `Topic: ${request.topic}`,
    request.qualityRules,
    request.existingFronts.length > 0
      ? `Avoid near-duplicates of: ${request.existingFronts.slice(0, 50).join(' | ')}`
      : '',
    excerpts,
    `Return JSON only.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function assignPositions(cards: GeneratedFlashcard[]): GeneratedFlashcard[] {
  return cards.map((card, index) => {
    const next: GeneratedFlashcard = {
      ...card,
      position: index + 1,
    };
    if (index === 0 && 'relationFromPrevious' in next) {
      delete next.relationFromPrevious;
    }
    return next;
  });
}

export function toFlashcardCreateInputs(input: {
  cards: GeneratedFlashcard[];
  folderPath: string;
  generationId: string;
  sequenceId: string;
  deck: string;
  pack: ContextPack;
}): FlashcardCreateInput[] {
  return input.cards.map((card) => {
    const first = input.pack.sources.find((source) => card.sourceChunkIds.includes(source.chunkId))
      ?? input.pack.sources[0];
    return {
      deck: input.deck,
      front: card.front,
      back: card.back,
      sourceFolder: input.folderPath,
      ...(first ? { sourceFile: first.relativePath, sourceExcerpt: first.text.slice(0, 400) } : {}),
      ...(typeof first?.startLine === 'number' ? { sourceLine: first.startLine } : {}),
      sequenceId: input.sequenceId,
      position: card.position,
      ...(card.cardType ? { cardType: card.cardType } : {}),
      generationId: input.generationId,
      ...(card.sourceChunkIds.length > 0 ? { sourceChunkIds: card.sourceChunkIds } : {}),
    };
  });
}

export async function writeGenerationRecord(input: {
  flashcardsRoot: string;
  generationId: string;
  folderKey: string;
  query: string;
  includeFiles: string[];
  sequenceId: string;
  createdCardIds: string[];
  retrievalMode: string;
  degraded: boolean;
}): Promise<void> {
  const path = join(input.flashcardsRoot, 'generations', `${input.generationId}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        id: input.generationId,
        folderKey: input.folderKey,
        query: input.query,
        includeFiles: input.includeFiles,
        sequenceId: input.sequenceId,
        createdCardIds: input.createdCardIds,
        retrievalMode: input.retrievalMode,
        degraded: input.degraded,
        pipelineVersion: SINGLE_PASS_PIPELINE,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export { FLASHCARD_QUALITY_RULES };
