/**
 * OpenAI-compatible / Cohere-shaped HTTP reranker.
 *
 * Tries `/rerank` first (Jina / Cohere / NewAPI). If that endpoint is missing,
 * falls back to a compact chat/completions ranking prompt. Failures surface to
 * `applyReranker`, which keeps the fused order.
 */
import type { SharedReranker } from '@piwin/contracts';

export type HttpRerankerOptions = {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  topK?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createHttpReranker(options: HttpRerankerOptions): SharedReranker {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    providerId: options.providerId,
    modelId: options.modelId,
    async rerank(input, signal) {
      const topK = input.topK ?? options.topK ?? input.documents.length;
      if (input.documents.length === 0) return [];
      const timeout = options.timeoutMs ?? 20_000;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

      const ranked = await tryNativeRerank(fetchImpl, baseUrl, headers, options, input, topK, signal, timeout);
      if (ranked) return ranked;
      return chatFallbackRerank(fetchImpl, baseUrl, headers, options, input, topK, signal, timeout);
    },
  };
}

async function tryNativeRerank(
  fetchImpl: typeof fetch,
  baseUrl: string,
  headers: Record<string, string>,
  options: HttpRerankerOptions,
  input: { query: string; documents: Array<{ id: string; text: string }> },
  topK: number,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Array<{ id: string; score: number }> | undefined> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/rerank`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.modelId,
        query: input.query,
        documents: input.documents.map((document) => document.text),
        top_n: topK,
      }),
      signal: controller.signal,
    });
    if (response.status === 404 || response.status === 405) return undefined;
    if (!response.ok) {
      throw new Error(`rerank request failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
    };
    const rows = payload.results;
    if (!Array.isArray(rows)) {
      throw new Error('rerank response missing results');
    }
    return rows
      .map((row) => {
        const index = typeof row.index === 'number' ? row.index : -1;
        const document = input.documents[index];
        if (!document) return undefined;
        const score =
          typeof row.relevance_score === 'number'
            ? row.relevance_score
            : typeof row.score === 'number'
              ? row.score
              : 0;
        return { id: document.id, score };
      })
      .filter((item): item is { id: string; score: number } => item !== undefined)
      .slice(0, topK);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function chatFallbackRerank(
  fetchImpl: typeof fetch,
  baseUrl: string,
  headers: Record<string, string>,
  options: HttpRerankerOptions,
  input: { query: string; documents: Array<{ id: string; text: string }> },
  topK: number,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Array<{ id: string; score: number }>> {
  const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const listed = input.documents
    .map((document, index) => `[${index + 1}] id=${document.id}\n${document.text.slice(0, 240)}`)
    .join('\n\n');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.modelId,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Rank documents by relevance to the query. Return JSON only: {"ids":["id1","id2"]}.',
          },
          {
            role: 'user',
            content: `Query: ${input.query}\n\nDocuments:\n${listed}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`rerank chat fallback failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed =
      start >= 0 && end > start ? (JSON.parse(text.slice(start, end + 1)) as { ids?: unknown }) : {};
    const ids = Array.isArray(parsed.ids)
      ? parsed.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const byId = new Map(input.documents.map((document) => [document.id, document]));
    const next: Array<{ id: string; score: number }> = [];
    ids.forEach((id, index) => {
      if (byId.has(id) && !next.some((item) => item.id === id)) {
        next.push({ id, score: 1 - index / Math.max(ids.length, 1) });
      }
    });
    return next.slice(0, topK);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
