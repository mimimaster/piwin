import type { ContextPack, KnowledgePoint } from '@piwin/contracts';
import { FLASHCARD_QUALITY_RULES } from '../quality-rules.js';

const MAX_EXISTING_FRONTS = 50;

export function buildOrderedFlashcardPrompt(input: {
  topic: string;
  workspaceName: string;
  pack: ContextPack;
  knowledgePoints: KnowledgePoint[];
  existingFronts: string[];
  qualityRules?: string;
}): string {
  const cited = new Set(input.knowledgePoints.flatMap((kp) => kp.sourceChunkIds));
  const excerpts = input.pack.sources
    .filter((source) => cited.has(source.chunkId))
    .map((source) => `[chunk ${source.chunkId}] ${source.relativePath}\n${source.text}`)
    .join('\n\n');
  const kps = input.knowledgePoints
    .map(
      (kp) =>
        `[${kp.id}] (${kp.type}, importance=${kp.importance.toFixed(2)}) ${kp.concept}: ${kp.statement} ← ${kp.sourceChunkIds.join(',')}`,
    )
    .join('\n');
  const existing = input.existingFronts.slice(0, MAX_EXISTING_FRONTS);
  return [
    'Write an ordered flashcard array from the knowledge points.',
    'position starts at 1 and increases by 1. relationFromPrevious must be empty on the first card.',
    'Every knowledgePointIds / sourceChunkIds value must exist below.',
    `Workspace: ${input.workspaceName}`,
    `Topic: ${input.topic}`,
    input.qualityRules ?? FLASHCARD_QUALITY_RULES,
    existing.length > 0 ? `Avoid near-duplicates of: ${existing.join(' | ')}` : '',
    `Knowledge points:\n${kps}`,
    excerpts,
    'Return JSON: { "cards": [{ "front", "back", "cardType", "relationFromPrevious", "knowledgePointIds", "sourceChunkIds" }] }',
  ]
    .filter(Boolean)
    .join('\n\n');
}
