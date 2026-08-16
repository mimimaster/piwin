import type {
  ContextPack,
  GeneratedFlashcard,
  KnowledgePoint,
  SharedEmbeddingProvider,
} from '@piwin/contracts';
import { FLASHCARD_QUALITY_RULES } from '../quality-rules.js';
import { qaGeneratedFlashcards } from './flashcard-qa.js';
import { buildOrderedFlashcardPrompt } from './flashcard-prompt.js';
import { GENERATED_FLASHCARD_SCHEMA, parseGeneratedFlashcards } from './flashcard-schema.js';
import { postprocessKnowledgePoints } from './kp-postprocess.js';
import { buildKnowledgePointPrompt } from './kp-prompt.js';
import { parseRawKnowledgePoints, RAW_KNOWLEDGE_POINT_SCHEMA } from './kp-schema.js';

export const TWO_STAGE_PIPELINE = 'v2-two-stage';

export type CompleteJsonFn = (input: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  signal?: AbortSignal;
}) => Promise<unknown>;

export type TwoStageGenerationResult = {
  knowledgePoints: KnowledgePoint[];
  cards: GeneratedFlashcard[];
  pipelineVersion: typeof TWO_STAGE_PIPELINE;
};

export async function runTwoStageGeneration(input: {
  topic: string;
  workspaceName: string;
  pack: ContextPack;
  existingFronts: string[];
  generationId: string;
  completeJson: CompleteJsonFn;
  embedding?: SharedEmbeddingProvider;
  signal?: AbortSignal;
}): Promise<TwoStageGenerationResult> {
  const rawValue = await completeWithRepair({
    completeJson: input.completeJson,
    systemPrompt: 'You extract knowledge points. Output JSON only.',
    userPrompt: buildKnowledgePointPrompt({
      topic: input.topic,
      workspaceName: input.workspaceName,
      pack: input.pack,
    }),
    jsonSchema: RAW_KNOWLEDGE_POINT_SCHEMA,
    schemaName: 'knowledge_points',
    parse: (value) => parseRawKnowledgePoints(value, input.pack),
    isValid: (parsed) => parsed.length > 0,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const knowledgePoints = await postprocessKnowledgePoints({
    raw: rawValue,
    pack: input.pack,
    generationId: input.generationId,
    ...(input.embedding ? { embedding: input.embedding } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (knowledgePoints.length === 0) {
    return { knowledgePoints, cards: [], pipelineVersion: TWO_STAGE_PIPELINE };
  }

  const cardsValue = await completeWithRepair({
    completeJson: input.completeJson,
    systemPrompt: 'You write ordered flashcards. Output JSON only.',
    userPrompt: buildOrderedFlashcardPrompt({
      topic: input.topic,
      workspaceName: input.workspaceName,
      pack: input.pack,
      knowledgePoints,
      existingFronts: input.existingFronts,
      qualityRules: FLASHCARD_QUALITY_RULES,
    }),
    jsonSchema: GENERATED_FLASHCARD_SCHEMA,
    schemaName: 'flashcards',
    parse: (value) => parseGeneratedFlashcards(value, input.pack, knowledgePoints),
    isValid: (parsed) => parsed.length > 0,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return {
    knowledgePoints,
    cards: qaGeneratedFlashcards({
      cards: cardsValue,
      pack: input.pack,
      knowledgePoints,
      existingFronts: input.existingFronts,
    }),
    pipelineVersion: TWO_STAGE_PIPELINE,
  };
}

async function completeWithRepair<T>(input: {
  completeJson: CompleteJsonFn;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  parse: (value: unknown) => T;
  isValid: (parsed: T) => boolean;
  signal?: AbortSignal;
}): Promise<T> {
  const first = await tryCall(input);
  if (first && input.isValid(first)) return first;
  const repaired = await tryCall({
    ...input,
    userPrompt: `${input.userPrompt}\n\nYour previous output was invalid JSON or had bad references. Return valid JSON only.`,
  });
  if (!repaired || !input.isValid(repaired)) {
    throw new Error('NO_VALID_FLASHCARDS');
  }
  return repaired;
}

async function tryCall<T>(input: {
  completeJson: CompleteJsonFn;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  parse: (value: unknown) => T;
  signal?: AbortSignal;
}): Promise<T | undefined> {
  try {
    return (await call(input)).parsed;
  } catch {
    return undefined;
  }
}

async function call<T>(input: {
  completeJson: CompleteJsonFn;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  parse: (value: unknown) => T;
  signal?: AbortSignal;
}): Promise<{ parsed: T }> {
  const value = await input.completeJson({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    jsonSchema: input.jsonSchema,
    schemaName: input.schemaName,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return { parsed: input.parse(value) };
}
