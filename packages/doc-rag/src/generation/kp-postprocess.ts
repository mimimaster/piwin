import type {
  ContextPack,
  KnowledgePoint,
  RawKnowledgePoint,
  SharedEmbeddingProvider,
} from '@piwin/contracts';

export const DEFAULT_MINIMUM_IMPORTANCE = 0.5;
export const DEFAULT_KP_DEDUP_SIMILARITY = 0.9;

export async function postprocessKnowledgePoints(input: {
  raw: RawKnowledgePoint[];
  pack: ContextPack;
  generationId: string;
  minimumImportance?: number;
  embedding?: SharedEmbeddingProvider;
  dedupSimilarity?: number;
  signal?: AbortSignal;
}): Promise<KnowledgePoint[]> {
  const minimum = input.minimumImportance ?? DEFAULT_MINIMUM_IMPORTANCE;
  const allowed = new Set(input.pack.sources.map((source) => source.chunkId));
  const normalized: RawKnowledgePoint[] = [];
  const seen = new Set<string>();
  for (const item of input.raw) {
    const sourceChunkIds = item.sourceChunkIds.filter((id) => allowed.has(id));
    if (sourceChunkIds.length === 0) continue;
    if (item.importance < minimum) continue;
    const concept = collapse(item.concept);
    const statement = collapse(item.statement);
    if (!concept || !statement) continue;
    const key = `${concept.toLowerCase()}\0${statement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ...item, concept, statement, sourceChunkIds });
  }

  const unique = input.embedding
    ? await dropSimilar(normalized, input.embedding, input.dedupSimilarity ?? DEFAULT_KP_DEDUP_SIMILARITY, input.signal)
    : normalized;

  return unique.map((item, index) => ({
    id: `kp_${input.generationId}_${index + 1}`,
    concept: item.concept,
    statement: item.statement,
    type: item.type,
    importance: item.importance,
    sourceChunkIds: item.sourceChunkIds,
    sourceOrder: sourceOrderFor(item.sourceChunkIds, input.pack),
  }));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sourceOrderFor(sourceChunkIds: string[], pack: ContextPack): number {
  let order = Number.POSITIVE_INFINITY;
  for (const [index, source] of pack.sources.entries()) {
    if (sourceChunkIds.includes(source.chunkId) && index < order) {
      order = index;
    }
  }
  return Number.isFinite(order) ? order : pack.sources.length;
}

async function dropSimilar(
  items: RawKnowledgePoint[],
  embedding: SharedEmbeddingProvider,
  threshold: number,
  signal?: AbortSignal,
): Promise<RawKnowledgePoint[]> {
  if (items.length < 2) return items;
  const vectors = await embedding.embedDocuments(
    items.map((item) => `${item.concept}. ${item.statement}`),
    signal,
  );
  const kept: RawKnowledgePoint[] = [];
  const keptVectors: number[][] = [];
  for (const [index, item] of items.entries()) {
    const vector = vectors[index];
    if (!vector) {
      kept.push(item);
      continue;
    }
    if (keptVectors.some((other) => cosine(vector, other) >= threshold)) continue;
    kept.push(item);
    keptVectors.push(vector);
  }
  return kept;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const size = Math.min(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}
