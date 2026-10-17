/**
 * Per-model custom request body (ADR 0095).
 *
 * A model may carry a JSON object that Host deep-merges into every request
 * body Pi builds for it — e.g. OpenRouter provider routing
 * (`{"provider":{"order":["anthropic"],"allow_fallbacks":false}}`) or sampling
 * parameters. This module is the only place that defines the merge rule and
 * the guard rails; Desktop validation and Host request shaping both use it.
 */
import type { ModelConfigEntry, ModelProviderConfig } from './config.js';
import { isSubscriptionProvider } from './subscription-oauth.js';

/** JSON value accepted inside a custom request body. */
export type RequestBodyJsonValue =
  | string
  | number
  | boolean
  | null
  | RequestBodyJsonValue[]
  | { [key: string]: RequestBodyJsonValue };

/** A custom request body: a JSON object merged into the provider payload. */
export type ModelRequestBody = { [key: string]: RequestBodyJsonValue };

/**
 * Top-level fields piwin generates on every wire (OpenAI Chat/Responses,
 * Anthropic Messages, Gemini, Bedrock Converse). Overriding them would replace
 * the conversation, the tool list or the streaming contract, so they are
 * rejected rather than merged.
 */
export const RESERVED_REQUEST_BODY_KEYS: readonly string[] = [
  'model',
  'modelId',
  'messages',
  'input',
  'instructions',
  'contents',
  'system',
  'tools',
  'stream',
];

/** Serialized size ceiling; a body is configuration, not content. */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;
/** Nesting ceiling (the root object is depth 1). */
export const MAX_REQUEST_BODY_DEPTH = 8;

export type RequestBodyIssue =
  | { code: 'not-object' }
  | { code: 'not-json'; path: string }
  | { code: 'reserved-key'; key: string }
  | { code: 'too-large'; limitBytes: number }
  | { code: 'too-deep'; limitDepth: number };

/** Validate a parsed custom request body; empty list = acceptable. */
export function validateModelRequestBody(value: unknown): RequestBodyIssue[] {
  if (!isPlainObject(value)) return [{ code: 'not-object' }];
  const issues: RequestBodyIssue[] = [];
  for (const key of Object.keys(value)) {
    if (RESERVED_REQUEST_BODY_KEYS.includes(key)) {
      issues.push({ code: 'reserved-key', key });
    }
  }
  const shapeIssue = findNonJsonValue(value, '', 1);
  if (shapeIssue) {
    issues.push(shapeIssue);
    return issues;
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_REQUEST_BODY_BYTES) {
    issues.push({ code: 'too-large', limitBytes: MAX_REQUEST_BODY_BYTES });
  }
  return issues;
}

/** English description for Host-side validation reports. */
export function describeRequestBodyIssue(issue: RequestBodyIssue): string {
  switch (issue.code) {
    case 'not-object':
      return 'request body must be a JSON object';
    case 'not-json':
      return `request body value at "${issue.path}" is not JSON`;
    case 'reserved-key':
      return `request body cannot override "${issue.key}"; piwin generates it`;
    case 'too-large':
      return `request body exceeds ${issue.limitBytes} bytes`;
    case 'too-deep':
      return `request body nests deeper than ${issue.limitDepth} levels`;
  }
}

/**
 * The custom body that applies to `model` on `provider`. Undefined when none
 * is set, when it is empty or invalid, or on subscriptions (their wire is
 * owned by the subscription transport).
 */
export function resolveModelRequestBody(
  provider: Pick<ModelProviderConfig, 'source'>,
  model: Pick<ModelConfigEntry, 'extraBody'> | undefined,
): ModelRequestBody | undefined {
  const body = model?.extraBody;
  if (!body || isSubscriptionProvider(provider)) return undefined;
  if (Object.keys(body).length === 0) return undefined;
  return validateModelRequestBody(body).length === 0 ? body : undefined;
}

/**
 * Deep-merge `extra` into a provider payload. Objects merge key by key;
 * arrays and scalars replace; a `null` value deletes the key. Reserved
 * top-level keys are never touched. The payload is not mutated.
 */
export function mergeModelRequestBody(payload: unknown, extra: ModelRequestBody | undefined): unknown {
  if (!extra || !isPlainObject(payload)) return payload;
  const merged: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(extra)) {
    if (RESERVED_REQUEST_BODY_KEYS.includes(key)) continue;
    mergeEntry(merged, key, value);
  }
  return merged;
}

function mergeEntry(target: Record<string, unknown>, key: string, value: RequestBodyJsonValue): void {
  if (value === null) {
    delete target[key];
    return;
  }
  if (isPlainObject(value)) {
    const current = target[key];
    const next: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
    for (const [childKey, childValue] of Object.entries(value)) {
      mergeEntry(next, childKey, childValue);
    }
    target[key] = next;
    return;
  }
  target[key] = value;
}

function findNonJsonValue(value: unknown, path: string, depth: number): RequestBodyIssue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : { code: 'not-json', path: path || '$' };
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    if (depth > MAX_REQUEST_BODY_DEPTH) return { code: 'too-deep', limitDepth: MAX_REQUEST_BODY_DEPTH };
    const entries: Array<[string, unknown]> = Array.isArray(value)
      ? value.map((item, index) => [`${path}[${index}]`, item])
      : Object.entries(value).map(([key, item]) => [path ? `${path}.${key}` : key, item]);
    for (const [childPath, child] of entries) {
      const issue = findNonJsonValue(child, childPath, depth + 1);
      if (issue) return issue;
    }
    return undefined;
  }
  return { code: 'not-json', path: path || '$' };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
