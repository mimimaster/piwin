/**
 * Sends the smallest valid generation request for one configured model.
 * This tests the endpoint, credentials, custom headers, and model identifier
 * together; it intentionally does not use the provider's `/models` endpoint.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import { ProviderModelDiscoveryError, buildProviderRequestHeaders } from './provider-model-discovery.js';

const MODEL_TEST_TIMEOUT_MS = 20_000;

export type ProviderModelTestDependencies = {
  fetch?: typeof globalThis.fetch;
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>;
};

export type ProviderModelTestResult = {
  providerId: string;
  modelId: string;
  durationMs: number;
};

export async function testProviderModel(
  provider: ModelProviderConfig,
  modelId: string,
  dependencies: ProviderModelTestDependencies,
): Promise<ProviderModelTestResult> {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    throw new ProviderModelDiscoveryError('Model test requires a model ID');
  }

  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new ProviderModelDiscoveryError('Model test is unavailable: fetch is not supported');
  }

  const request = buildModelTestRequest(provider, normalizedModelId);
  const headers = await buildProviderRequestHeaders(provider, dependencies.resolveSecret);
  headers.set('content-type', 'application/json');

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), MODEL_TEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetchImplementation(request.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request.body),
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new ProviderModelDiscoveryError(
        `Model test failed (${response.status} ${response.statusText || 'request rejected'})`,
      );
    }
    return {
      providerId: provider.id,
      modelId: normalizedModelId,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof ProviderModelDiscoveryError) {
      throw error;
    }
    if (abortController.signal.aborted) {
      throw new ProviderModelDiscoveryError('Model test timed out after 20 seconds');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderModelDiscoveryError(`Model test failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function buildModelTestRequest(
  provider: ModelProviderConfig,
  modelId: string,
): { endpoint: string; body: Record<string, unknown> } {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new ProviderModelDiscoveryError('Model test requires a Base URL');
  }

  if (provider.protocol === 'google-gemini') {
    return {
      endpoint: `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`,
      body: {
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 },
      },
    };
  }

  if (provider.protocol === 'anthropic-compatible') {
    const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
    return {
      endpoint,
      body: {
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
    };
  }

  const endpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
  return {
    endpoint,
    body: {
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    },
  };
}
