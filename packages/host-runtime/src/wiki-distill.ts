/**
 * Wiki distillation: retrieve a source base's slices, synthesise one concept
 * with the model, write it into the wiki. The "生肉信源 → 熟肉维基" hop of the
 * knowledge flywheel — the counterpart to doccards generation for flashcards.
 */
import type { CompleteJsonFn } from '@piwin/doc-rag';
import type { KnowledgeBaseSummary, WikiDistillResult } from '@piwin/contracts';
import { writeWikiConcept } from './wiki-service.js';

export class WikiDistillError extends Error {
  override readonly name = 'WikiDistillError';
}

const CONCEPT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'tags', 'content'],
  properties: {
    title: {
      type: 'string',
      description: 'Concept name — a noun phrase, not a sentence.',
    },
    summary: {
      type: 'string',
      description: 'One line, for the INDEX.md catalog row.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lowercase domain tags, no # prefix.',
    },
    content: {
      type: 'string',
      description:
        'Markdown body. Cross-reference other concepts as [[Concept Name]]. Define the concept, then its key claims. No heading duplicating the title.',
    },
  },
};

const SYSTEM_PROMPT = [
  'You compile a personal encyclopedia from raw source material (the LLM-Wiki pattern).',
  'Distil the excerpts into ONE well-defined concept entry: deduplicate, resolve contradictions,',
  'and state what is actually supported by the sources. Never invent facts the excerpts do not support.',
  'Cross-reference related concepts as [[Concept Name]]. Write in the language of the source material.',
  'Output JSON only.',
].join(' ');

export type WikiDistillSource = {
  relativePath: string;
  text: string;
};

function buildUserPrompt(input: {
  baseName: string;
  topic: string | undefined;
  sources: readonly WikiDistillSource[];
}): string {
  const excerpts = input.sources
    .map((source, index) => `[${index + 1}] ${source.relativePath}\n${source.text}`)
    .join('\n\n');
  return [
    `Source base: ${input.baseName}`,
    input.topic ? `Focus the entry on: ${input.topic}` : 'Pick the single most load-bearing concept in these excerpts.',
    'Excerpts:',
    excerpts,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function parseConcept(value: unknown): {
  title: string;
  summary: string;
  tags: string[];
  content: string;
} {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const content = typeof record.content === 'string' ? record.content.trim() : '';
  if (!title || !content) {
    throw new WikiDistillError('The model did not return a usable concept entry.');
  }
  return {
    title,
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    content,
  };
}

/** Synthesises and persists one concept. Sources must already be retrieved. */
export async function distillWikiConcept(input: {
  piwinRoot: string | undefined;
  base: Pick<KnowledgeBaseSummary, 'id' | 'name'>;
  sources: readonly WikiDistillSource[];
  topic?: string | undefined;
  completeJson: CompleteJsonFn;
  signal?: AbortSignal | undefined;
}): Promise<WikiDistillResult> {
  if (input.sources.length === 0) {
    throw new WikiDistillError(
      'This source has no indexed slices yet — ingest it before distilling.',
    );
  }

  const raw = await input.completeJson({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt({
      baseName: input.base.name,
      topic: input.topic,
      sources: input.sources,
    }),
    jsonSchema: CONCEPT_SCHEMA,
    schemaName: 'wiki_concept',
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const parsed = parseConcept(raw);
  const sourcePaths = [...new Set(input.sources.map((source) => source.relativePath))];
  const concept = await writeWikiConcept(input.piwinRoot, {
    title: parsed.title,
    content: parsed.content,
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    tags: parsed.tags,
    logMessage: `Distilled [[${parsed.title}]] from ${input.base.name} (${sourcePaths.length} slices)`,
  });

  return { concept, baseId: input.base.id, sourcePaths };
}
