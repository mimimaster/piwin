/**
 * Listwise LLM rerank over fused hits (ADR 0018 §5; default off).
 *
 * Calls an OpenAI-compatible chat completions endpoint with a compact
 * listwise prompt and reorders hits by the returned id ranking. Any failure
 * (network, malformed output) returns the original order — rerank is an
 * enhancement and must never degrade search below its input.
 */
import type { NoteSearchHit, RerankProvider } from '@piwin/contracts';

export type LlmRerankOptions = {
  baseUrl: string;
  model: string;
  /** Resolved secret (host resolves refs; never logged). */
  apiKey?: string;
  /** Max hits sent to the model. Default 20. */
  maxCandidates?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_MAX_CANDIDATES = 20;
const SNIPPET_CHARS = 200;

export function createLlmRerank(options: LlmRerankOptions): RerankProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  return {
    id: 'llm',

    async rerank(query, hits, signal) {
      if (hits.length < 2) {
        return hits;
      }
      const candidates = hits.slice(0, maxCandidates);
      const rest = hits.slice(maxCandidates);

      try {
        const ranking = await requestRanking(
          fetchImpl,
          endpoint,
          options,
          query,
          candidates,
          signal,
        );
        const reordered = applyRanking(candidates, ranking);
        return [...reordered, ...rest];
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        // Boundary log without attacker/model-controlled ranking content.
        console.warn(
          `[piwin/notes] llm rerank failed, keeping fused order: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return hits;
      }
    },
  };
}

async function requestRanking(
  fetchImpl: typeof fetch,
  endpoint: string,
  options: LlmRerankOptions,
  query: string,
  candidates: NoteSearchHit[],
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const documents = candidates
    .map(
      (hit, index) =>
        `[${index + 1}] id=${hit.note.id}\ntitle: ${hit.note.title}\nsnippet: ${hit.snippet.slice(0, SNIPPET_CHARS)}`,
    )
    .join('\n\n');
  const prompt = [
    'You are a search reranker. Rank the documents below by relevance to the query.',
    `Query: ${query}`,
    '',
    documents,
    '',
    'Reply with ONLY a JSON array of document ids, most relevant first.',
    'Example: ["note-abc","note-def"]',
  ].join('\n');

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`rerank request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? '';
  return parseRankingIds(content);
}

/** Extract a JSON string array from model output (tolerates fences/prose). */
export function parseRankingIds(content: string): string[] {
  const match = content.match(/\[[\s\S]*?\]/);
  if (!match) {
    throw new Error('no ranking array in response');
  }
  const parsed = JSON.parse(match[0]) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('ranking is not an array');
  }
  const ids = parsed.filter((item): item is string => typeof item === 'string');
  if (ids.length === 0) {
    throw new Error('ranking array empty');
  }
  return ids;
}

/**
 * Reorder candidates by ranking; unknown ids ignored, missing candidates
 * appended in original order (model output is untrusted and may be partial).
 */
export function applyRanking(
  candidates: NoteSearchHit[],
  ranking: string[],
): NoteSearchHit[] {
  const byId = new Map(candidates.map((hit) => [hit.note.id, hit]));
  const reordered: NoteSearchHit[] = [];
  const seen = new Set<string>();
  for (const id of ranking) {
    const hit = byId.get(id);
    if (hit && !seen.has(id)) {
      seen.add(id);
      reordered.push(hit);
    }
  }
  for (const hit of candidates) {
    if (!seen.has(hit.note.id)) {
      reordered.push(hit);
    }
  }
  return reordered.map((hit, index) => ({
    ...hit,
    rank: { ...hit.rank, reranked: index + 1 },
  }));
}
