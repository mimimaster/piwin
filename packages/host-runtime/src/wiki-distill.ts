/**
 * Wiki distillation: retrieve a source base's slices, synthesise one concept
 * with the model, write it into the wiki. The "生肉信源 → 熟肉维基" hop of the
 * knowledge flywheel — the counterpart to doccards generation for flashcards.
 */
import type { CompleteJsonFn } from '@piwin/doc-rag';
import type {
  KnowledgeBaseSummary,
  WikiConceptItem,
  WikiDistillDraft,
  WikiDistillResult,
} from '@piwin/contracts';
import { suggestRelatedWikiPages } from './wiki-related.js';
import { readWikiConcept, slugify, writeWikiConcept } from './wiki-service.js';

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

type ParsedConcept = {
  title: string;
  summary: string;
  tags: string[];
  content: string;
};

function parseConcept(value: unknown): ParsedConcept {
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

async function synthesizeWikiConcept(input: {
  baseName: string;
  sources: readonly WikiDistillSource[];
  topic?: string | undefined;
  completeJson: CompleteJsonFn;
  signal?: AbortSignal | undefined;
}): Promise<ParsedConcept> {
  if (input.sources.length === 0) {
    throw new WikiDistillError(
      'This source has no indexed slices yet — ingest it before distilling.',
    );
  }
  const raw = await input.completeJson({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt({
      baseName: input.baseName,
      topic: input.topic,
      sources: input.sources,
    }),
    jsonSchema: CONCEPT_SCHEMA,
    schemaName: 'wiki_concept',
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return parseConcept(raw);
}

function sourceRefs(
  baseId: string,
  sources: readonly WikiDistillSource[],
): WikiDistillDraft['sources'] {
  const seen = new Set<string>();
  const refs: WikiDistillDraft['sources'] = [];
  for (const source of sources) {
    if (seen.has(source.relativePath)) continue;
    seen.add(source.relativePath);
    refs.push({ baseId, relativePath: source.relativePath });
  }
  return refs;
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
  const parsed = await synthesizeWikiConcept({
    baseName: input.base.name,
    sources: input.sources,
    completeJson: input.completeJson,
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const refs = sourceRefs(input.base.id, input.sources);
  const concept = await writeWikiConcept(input.piwinRoot, {
    title: parsed.title,
    content: parsed.content,
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    tags: parsed.tags,
    sources: refs,
    logMessage: `Distilled [[${parsed.title}]] from ${input.base.name} (${refs.length} slices)`,
  });
  return { concept, baseId: input.base.id, sourcePaths: refs.map((ref) => ref.relativePath) };
}

/** Synthesises a concept without writing. Related pages come from the current catalog. */
export async function distillWikiConceptDraft(input: {
  piwinRoot: string | undefined;
  base: Pick<KnowledgeBaseSummary, 'id' | 'name'>;
  sources: readonly WikiDistillSource[];
  concepts: readonly WikiConceptItem[];
  topic?: string | undefined;
  completeJson: CompleteJsonFn;
  signal?: AbortSignal | undefined;
}): Promise<WikiDistillDraft> {
  const parsed = await synthesizeWikiConcept({
    baseName: input.base.name,
    sources: input.sources,
    completeJson: input.completeJson,
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const slug = slugify(parsed.title);
  const suggestion = suggestRelatedWikiPages({
    title: parsed.title,
    tags: parsed.tags,
    concepts: input.concepts,
    slug,
  });
  let existingPage: WikiDistillDraft['existingPage'];
  if (suggestion.existingSlug) {
    const existing = await readWikiConcept(input.piwinRoot, suggestion.existingSlug);
    if (existing?.contentHash) {
      existingPage = {
        slug: existing.slug,
        title: existing.title,
        content: existing.content,
        contentHash: existing.contentHash,
      };
    }
  }
  return {
    title: parsed.title,
    summary: parsed.summary,
    tags: parsed.tags,
    content: parsed.content,
    sources: sourceRefs(input.base.id, input.sources),
    relatedPages: suggestion.related,
    ...(existingPage ? { existingPage } : {}),
  };
}
