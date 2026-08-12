/** Narrow model-delegation port and response parser for Host `web_search`. */

import type { ModelRef, SearchHit } from '@piwin/contracts';

export type WebSearchModelDelegate = {
  model: ModelRef;
  search: (query: string, options: { limit: number; signal?: AbortSignal }) => Promise<SearchHit[]>;
};

export class WebSearchModelDelegateResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchModelDelegateResponseError';
  }
}

/** Parse the delegate's strict JSON response into bounded normalized hits. */
export function parseWebSearchModelResponse(text: string, limit: number): SearchHit[] {
  const parsed = parseJsonPayload(text);
  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.hits)
      ? parsed.hits
      : isRecord(parsed) && Array.isArray(parsed.results)
        ? parsed.results
        : [];
  const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
  const hits: SearchHit[] = [];
  const seenUrls = new Set<string>();
  for (const item of items) {
    const hit = normalizeHit(item);
    if (!hit) continue;
    const key = hit.url.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    hits.push(hit);
    if (hits.length >= boundedLimit) break;
  }
  if (hits.length === 0) {
    throw new WebSearchModelDelegateResponseError(
      'Delegated web search returned no valid http(s) result hits',
    );
  }
  return hits;
}

export function sameModelRef(left: ModelRef, right: ModelRef): boolean {
  return (
    left.protocol === right.protocol &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId
  );
}

function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  const direct = tryParseJson(unfenced);
  if (direct !== undefined) {
    return direct;
  }
  const objectStart = unfenced.indexOf('{');
  const objectEnd = unfenced.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const embedded = tryParseJson(unfenced.slice(objectStart, objectEnd + 1));
    if (embedded !== undefined) {
      return embedded;
    }
  }
  throw new WebSearchModelDelegateResponseError(
    'Delegated web search did not return the required JSON object',
  );
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeHit(value: unknown): SearchHit | undefined {
  if (!isRecord(value)) return undefined;
  const url = readHttpUrl(value.url ?? value.link ?? value.uri);
  if (!url) return undefined;
  const title = firstNonEmptyString(value.title, value.name) ?? url;
  const snippet =
    firstNonEmptyString(value.snippet, value.description, value.summary, value.content) ?? '';
  return {
    title,
    url,
    snippet,
    source: 'model-delegate',
  };
}

function readHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
