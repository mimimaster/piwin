/**
 * Provider-agnostic non-streaming completion. Walkthrough and Doc Cards
 * generation share HTTP / auth / protocol parsing through this module.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { buildProviderRequestHeaders } from './provider-model-discovery.js';
import { createSecretResolver } from './secret-resolver.js';
import { StructuredCompletionError } from './structured-completion-error.js';
import {
  buildCompletionBody,
  buildCompletionEndpoint,
  completionLabel,
  extractJsonValue,
  parseCompletionResponse,
  type StructuredCompletionRequest,
} from './structured-completion-protocol.js';

export type { StructuredCompletionRequest } from './structured-completion-protocol.js';
export { StructuredCompletionError } from './structured-completion-error.js';
export type { StructuredCompletionErrorCode } from './structured-completion-error.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export type StructuredCompletionResult = {
  text: string;
};

export type StructuredCompletionDependencies = {
  fetch?: typeof globalThis.fetch;
  resolveSecret?: (provider: ModelProviderConfig) => Promise<string | null>;
};

export async function completeStructuredText(
  request: StructuredCompletionRequest,
  dependencies: StructuredCompletionDependencies = {},
): Promise<StructuredCompletionResult> {
  const label = completionLabel(request);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} completion is unavailable: fetch is not supported`,
    );
  }

  const resolveSecret = createCompletionSecretResolver(dependencies.resolveSecret);
  const endpoint = buildCompletionEndpoint(request.provider, request.modelId, label);
  const headers = await buildProviderRequestHeaders(request.provider, resolveSecret);
  headers.set('content-type', 'application/json');
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const externalSignal = request.signal;
  if (externalSignal.aborted) {
    throw new StructuredCompletionError('cancelled', `${label} generation was cancelled`);
  }
  const timeoutController = new AbortController();
  const onExternalAbort = () => timeoutController.abort();
  externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const payload = await postCompletion(fetchImplementation, endpoint, headers, request, timeoutController.signal);
    return { text: parseCompletionResponse(request.provider.protocol, payload, label) };
  } catch (error) {
    if (error instanceof StructuredCompletionError) throw error;
    if (externalSignal.aborted) {
      throw new StructuredCompletionError('cancelled', `${label} generation was cancelled`);
    }
    if (timeoutController.signal.aborted) {
      throw new StructuredCompletionError(
        'provider-timeout',
        `${label} generation timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      );
    }
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} generation failed: ${formatError(error)}`,
    );
  } finally {
    clearTimeout(timeout);
    externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

export async function completeStructured<T>(
  request: StructuredCompletionRequest,
  parse: (value: unknown) => T,
  dependencies: StructuredCompletionDependencies = {},
): Promise<T> {
  const label = completionLabel(request);
  const { text } = await completeStructuredText(request, dependencies);
  const value = extractJsonValue(text);
  if (value === undefined) {
    throw new StructuredCompletionError(
      'schema-failed',
      `${label} generation did not return valid JSON`,
    );
  }
  try {
    return parse(value);
  } catch (error) {
    throw new StructuredCompletionError(
      'schema-failed',
      `${label} generation JSON did not match the expected schema: ${formatError(error)}`,
    );
  }
}

async function postCompletion(
  fetchImplementation: typeof globalThis.fetch,
  endpoint: string,
  headers: Headers,
  request: StructuredCompletionRequest,
  signal: AbortSignal,
): Promise<unknown> {
  const body = buildCompletionBody(request);
  const response = await fetchImplementation(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (response.ok) {
    return response.json();
  }
  // Many local / aggregator proxies reject OpenAI json_schema. The prompt
  // already carries the schema text; retry once as plain JSON.
  if (request.jsonSchema && shouldRetryWithoutJsonSchema(response.status)) {
    const withoutSchema: StructuredCompletionRequest = {
      provider: request.provider,
      modelId: request.modelId,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      signal: request.signal,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.label ? { label: request.label } : {}),
    };
    const fallback = await fetchImplementation(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildCompletionBody(withoutSchema)),
      signal,
    });
    if (fallback.ok) {
      return fallback.json();
    }
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${completionLabel(request)} generation failed (${fallback.status} ${fallback.statusText || 'request rejected'})`,
    );
  }
  throw new StructuredCompletionError(
    'provider-request-failed',
    `${completionLabel(request)} generation failed (${response.status} ${response.statusText || 'request rejected'})`,
  );
}

function shouldRetryWithoutJsonSchema(status: number): boolean {
  return status === 400 || status === 404 || status === 415 || status === 422;
}

/**
 * Resolve a provider secret, mapping a configured-but-unresolvable key to a
 * named error. Exported so other provider-calling modules (code_search's
 * subagent backend) reuse the same policy instead of re-deriving it.
 */
export function createCompletionSecretResolver(
  injected: StructuredCompletionDependencies['resolveSecret'],
): (provider: ModelProviderConfig) => Promise<string | null> {
  if (injected) return injected;
  const resolver = createSecretResolver();
  return async (provider) => {
    const hasKeySource = Boolean(provider.apiKeyEnv?.trim() || provider.apiKeyRef?.trim());
    if (!hasKeySource) return null;
    try {
      return await resolver.resolveProviderSecret(provider);
    } catch {
      throw new StructuredCompletionError(
        'missing-credentials',
        `Provider ${provider.id}: API key is configured but could not be resolved.`,
      );
    }
  };
}
