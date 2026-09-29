/**
 * Direct non-streaming Gemini `generateContent` call for native search. Pi's
 * Google adapter rejects a custom `fetch`, so grounding metadata cannot be
 * observed through Pi; this path is the only Gemini native executor. API-key
 * providers only — Vertex and gemini-cli OAuth fail closed.
 */
import { buildGeminiRestHeaders } from './native-search-headers.js';
import type { FetchLike } from './native-search-tee.js';

export class GeminiRestSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiRestSearchError';
  }
}

export type GeminiRestSearchRequest = {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  headers?: Readonly<Record<string, string>>;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

/** Returns the raw response body for `parseGeminiEvidence`. */
export async function completeGeminiRestSearch(
  request: GeminiRestSearchRequest,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<string> {
  const apiKey = request.apiKey?.trim();
  if (!apiKey) {
    throw new GeminiRestSearchError('Gemini native search requires an API key (OAuth/Vertex unsupported)');
  }
  const endpoint = buildGenerateContentUrl(request.baseUrl, request.modelId);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: buildGeminiRestHeaders(apiKey, request.headers),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: request.maxOutputTokens },
    }),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new GeminiRestSearchError(`Gemini native search HTTP ${response.status}`);
  }
  return body;
}

function buildGenerateContentUrl(baseUrl: string, modelId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new GeminiRestSearchError('Gemini native search requires an http(s) base URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new GeminiRestSearchError('Gemini native search requires an http(s) base URL');
  }
  if (parsed.hostname.endsWith('aiplatform.googleapis.com')) {
    throw new GeminiRestSearchError('Vertex AI native search is not supported');
  }
  const root = baseUrl.replace(/\/+$/u, '');
  const versioned = /\/v1(beta|alpha)?$/u.test(root) ? root : `${root}/v1beta`;
  const model = modelId.startsWith('models/') ? modelId.slice('models/'.length) : modelId;
  return `${versioned}/models/${encodeURIComponent(model)}:generateContent`;
}
