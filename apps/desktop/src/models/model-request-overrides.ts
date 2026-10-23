/**
 * Pure text ⇄ config helpers for a model's custom request headers and body
 * (ADR 0095). The editor keeps raw JSON text so a half-typed value never
 * loses characters; these helpers decide what that text means.
 */
import {
  validateModelRequestBody,
  type ModelProviderConfig,
  type ModelRequestBody,
  type RequestBodyIssue,
} from '@piwin/contracts';

export type RequestBodyTextError =
  | { kind: 'syntax'; message: string }
  | { kind: 'issue'; issue: RequestBodyIssue };

export type RequestBodyTextResult =
  | { ok: true; body: ModelRequestBody | undefined }
  | { ok: false; error: RequestBodyTextError };

/** Blank or `{}` → no body. */
export function parseRequestBodyText(text: string): RequestBodyTextResult {
  if (!text.trim()) return { ok: true, body: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: { kind: 'syntax', message: describeSyntaxError(error) } };
  }
  const issue = validateModelRequestBody(parsed)[0];
  if (issue) return { ok: false, error: { kind: 'issue', issue } };
  const body = parsed as ModelRequestBody;
  return { ok: true, body: Object.keys(body).length > 0 ? body : undefined };
}

export function formatRequestBodyText(body: ModelRequestBody | undefined): string {
  return body && Object.keys(body).length > 0 ? JSON.stringify(body, null, 2) : '';
}

export type HeadersTextError =
  | { kind: 'syntax'; message: string }
  | { kind: 'not-object' }
  | { kind: 'not-string'; name: string }
  | { kind: 'invalid-name'; name: string }
  | { kind: 'duplicate'; name: string };

export type HeadersTextResult =
  | { ok: true; headers: Record<string, string> | undefined }
  | { ok: false; error: HeadersTextError };

/** Parse a JSON header map; blank → none. Names are trimmed, values kept verbatim. */
export function parseHeadersJsonText(text: string): HeadersTextResult {
  if (!text.trim()) return { ok: true, headers: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: { kind: 'syntax', message: describeSyntaxError(error) } };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: { kind: 'not-object' } };
  }
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, value] of Object.entries(parsed)) {
    const name = rawName.trim();
    if (!name || /[\s:]/u.test(name)) return { ok: false, error: { kind: 'invalid-name', name: rawName } };
    if (typeof value !== 'string') return { ok: false, error: { kind: 'not-string', name } };
    const lower = name.toLowerCase();
    if (seen.has(lower)) return { ok: false, error: { kind: 'duplicate', name } };
    seen.add(lower);
    headers[name] = value;
  }
  return { ok: true, headers: Object.keys(headers).length > 0 ? headers : undefined };
}

export function formatHeadersJsonText(headers: Record<string, string> | undefined): string {
  return headers && Object.keys(headers).length > 0 ? JSON.stringify(headers, null, 2) : '';
}

/** Top-level body keys, for the "will merge" status line. */
export function requestBodyTopLevelKeys(body: ModelRequestBody | undefined): string[] {
  return body ? Object.keys(body) : [];
}

export type RequestBodyTemplateId = 'openrouter-upstream' | 'sampling' | 'remove-field';

export type RequestBodyTemplate = {
  id: RequestBodyTemplateId;
  body: ModelRequestBody;
};

export const REQUEST_BODY_TEMPLATES: readonly RequestBodyTemplate[] = [
  {
    id: 'openrouter-upstream',
    body: { provider: { order: ['anthropic'], allow_fallbacks: false } },
  },
  { id: 'sampling', body: { temperature: 0.7, top_p: 0.95 } },
  { id: 'remove-field', body: { store: null } },
];

/**
 * Merge a template into the current text. Template `null`s are kept as
 * literal deletions (the user is adding them to their own body), so this is
 * a plain recursive object merge rather than the request-time merge.
 */
export function applyRequestBodyTemplate(
  text: string,
  template: ModelRequestBody,
): { ok: true; text: string } | { ok: false; error: RequestBodyTextError } {
  const current = parseRequestBodyText(text);
  if (!current.ok) return current;
  return { ok: true, text: formatRequestBodyText(mergeJsonObjects(current.body ?? {}, template)) };
}

function mergeJsonObjects(base: ModelRequestBody, extra: ModelRequestBody): ModelRequestBody {
  const merged: ModelRequestBody = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key];
    merged[key] =
      isJsonObject(value) && isJsonObject(current) ? mergeJsonObjects(current, value) : value;
  }
  return merged;
}

// ── OpenRouter provider routing ──────────────────────────────────────────

export type OpenRouterSort = '' | 'price' | 'throughput' | 'latency';

export type OpenRouterRouting = {
  /** Upstream provider slugs tried in order (`provider.order`). */
  order: string[];
  /** `provider.allow_fallbacks` (OpenRouter default: true). */
  allowFallbacks: boolean;
  /** `provider.sort`; '' = OpenRouter's default load balancing. */
  sort: OpenRouterSort;
};

/** Common OpenRouter upstream slugs offered as quick picks. */
export const OPENROUTER_UPSTREAM_SUGGESTIONS: readonly string[] = [
  'anthropic',
  'openai',
  'google-vertex',
  'google-ai-studio',
  'amazon-bedrock',
  'azure',
  'deepseek',
  'fireworks',
  'together',
  'groq',
  'deepinfra',
];

export function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/** Whether the body already carries OpenRouter-style routing. */
export function hasOpenRouterRouting(body: ModelRequestBody | undefined): boolean {
  const provider = body?.provider;
  return isJsonObject(provider) && ('order' in provider || 'only' in provider);
}

export function readOpenRouterRouting(body: ModelRequestBody | undefined): OpenRouterRouting {
  const provider = isJsonObject(body?.provider) ? body.provider : {};
  const order = Array.isArray(provider.order)
    ? provider.order.filter((slug): slug is string => typeof slug === 'string')
    : [];
  const sort = provider.sort;
  return {
    order,
    allowFallbacks: provider.allow_fallbacks !== false,
    sort: sort === 'price' || sort === 'throughput' || sort === 'latency' ? sort : '',
  };
}

/**
 * Write routing back into `body.provider`, keeping any other `provider`
 * fields the user typed. Defaults are removed rather than written, and an
 * emptied `provider` object is dropped.
 */
export function writeOpenRouterRouting(
  body: ModelRequestBody | undefined,
  routing: OpenRouterRouting,
): ModelRequestBody | undefined {
  const next: ModelRequestBody = { ...(body ?? {}) };
  const provider: ModelRequestBody = isJsonObject(next.provider) ? { ...next.provider } : {};
  if (routing.order.length > 0) provider.order = routing.order;
  else delete provider.order;
  if (routing.allowFallbacks) delete provider.allow_fallbacks;
  else provider.allow_fallbacks = false;
  if (routing.sort) provider.sort = routing.sort;
  else delete provider.sort;
  if (Object.keys(provider).length > 0) next.provider = provider;
  else delete next.provider;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Comma/space separated slugs → unique, trimmed list. */
export function parseUpstreamList(text: string): string[] {
  const slugs = text
    .split(/[,，\s]+/u)
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  return [...new Set(slugs)];
}

// ── Protocol hints ───────────────────────────────────────────────────────

export type RequestBodyWireHint = 'openai' | 'anthropic' | 'gemini' | 'bedrock';

/** Which payload shape the body merges into for this model's wire. */
export function requestBodyWireHint(protocol: ModelProviderConfig['protocol']): RequestBodyWireHint {
  switch (protocol) {
    case 'anthropic-compatible':
      return 'anthropic';
    case 'google-gemini':
    case 'google-vertex':
      return 'gemini';
    case 'amazon-bedrock':
      return 'bedrock';
    case 'openai-compatible':
      return 'openai';
  }
}

function isJsonObject(value: unknown): value is ModelRequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeSyntaxError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
