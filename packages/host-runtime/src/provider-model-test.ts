/**
 * Sends the smallest valid generation request for one configured model.
 * This tests the endpoint, credentials, custom headers, model identifier, and
 * chat transport together; it intentionally does not use the provider's
 * `/models` endpoint. The URL comes from `provider-endpoint.ts`, so a passing
 * test means Pi's runtime request goes to the same place.
 */
import type { ModelProviderConfig, ProviderChatApi } from '@piwin/contracts';
import {
  formatError,
  isCloudCredentialProtocol,
  mergeModelRequestBody,
  resolveModelHeaders,
  resolveModelRequestBody,
} from '@piwin/contracts';
import { completeModelText } from '@piwin/agent-host';
import {
  ProviderModelDiscoveryError,
  buildProviderRequestHeaders,
} from './provider-model-discovery.js';
import {
  ProviderEndpointError,
  resolveEffectiveChatApi,
  resolveProviderChatEndpoint,
} from './provider-endpoint.js';
import { formatProviderHttpFailure } from './provider-http-failure.js';

const MODEL_TEST_TIMEOUT_MS = 20_000;
/** OpenAI Responses rejects `max_output_tokens` below 16. */
const RESPONSES_MIN_OUTPUT_TOKENS = 16;

export type ProviderModelTestDependencies = {
  fetch?: typeof globalThis.fetch;
  /** Pi SDK completion used for Vertex / Bedrock (no plain HTTP endpoint). */
  completeModelText?: typeof completeModelText;
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>;
};

export type ProviderModelTestResult = {
  providerId: string;
  modelId: string;
  durationMs: number;
  /** Transport the probe used; mirrors the Pi runtime for this provider. */
  chatApi: ProviderChatApi;
  /** Exact URL the probe POSTed to (no secrets: auth travels in headers). */
  endpoint: string;
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

  if (isCloudCredentialProtocol(provider.protocol)) {
    return testCloudProviderModel(provider, normalizedModelId, dependencies);
  }

  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new ProviderModelDiscoveryError('Model test is unavailable: fetch is not supported');
  }

  const chatApi = resolveEffectiveChatApi(provider);
  const request = buildModelTestRequest(provider, normalizedModelId, chatApi);
  // Probe with the model's own headers and body so a pass means chat passes.
  const model = provider.models.find((entry) => entry.id === normalizedModelId);
  const modelHeaders = resolveModelHeaders(provider, model);
  const headers = await buildProviderRequestHeaders(
    modelHeaders ? { ...provider, headers: modelHeaders } : provider,
    dependencies.resolveSecret,
  );
  headers.set('content-type', 'application/json');
  // Pi's Gemini SDK payload (`config`) is not the REST probe shape; skip it there.
  const body =
    chatApi === 'google-generative-ai'
      ? request.body
      : mergeModelRequestBody(request.body, resolveModelRequestBody(provider, model));

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), MODEL_TEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetchImplementation(request.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new ProviderModelDiscoveryError(
        `Model test failed (${await formatProviderHttpFailure(response)})`,
        { kind: 'http', httpStatus: response.status },
      );
    }
    return {
      providerId: provider.id,
      modelId: normalizedModelId,
      durationMs: Date.now() - startedAt,
      chatApi,
      endpoint: request.endpoint,
    };
  } catch (error) {
    if (error instanceof ProviderModelDiscoveryError) {
      throw error;
    }
    if (abortController.signal.aborted) {
      throw new ProviderModelDiscoveryError('Model test timed out after 20 seconds', {
        kind: 'timeout',
      });
    }
    const message = formatError(error);
    throw new ProviderModelDiscoveryError(`Model test failed: ${message}`, { kind: 'network' });
  } finally {
    clearTimeout(timeout);
  }
}

function buildModelTestRequest(
  provider: ModelProviderConfig,
  modelId: string,
  chatApi: ProviderChatApi,
): { endpoint: string; body: Record<string, unknown> } {
  let endpoint: string;
  try {
    endpoint = resolveProviderChatEndpoint(provider, modelId, chatApi);
  } catch (error) {
    if (error instanceof ProviderEndpointError) {
      throw new ProviderModelDiscoveryError(`Model test: ${error.message}`);
    }
    throw error;
  }

  switch (chatApi) {
    case 'google-vertex':
    case 'bedrock-converse-stream':
      throw new ProviderModelDiscoveryError(`Model test: ${chatApi} is tested through Pi`);
    case 'google-generative-ai':
      return {
        endpoint,
        body: {
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1 },
        },
      };
    case 'anthropic-messages':
      return {
        endpoint,
        body: {
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
      };
    case 'openai-responses':
      return {
        endpoint,
        body: {
          model: modelId,
          input: 'ping',
          max_output_tokens: RESPONSES_MIN_OUTPUT_TOKENS,
          stream: false,
        },
      };
    case 'openai-completions':
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
}

/**
 * Vertex / Bedrock: one tiny completion through Pi's own transport, so ADC /
 * AWS-chain auth, project/location and region are exercised exactly as in chat.
 */
async function testCloudProviderModel(
  provider: ModelProviderConfig,
  modelId: string,
  dependencies: ProviderModelTestDependencies,
): Promise<ProviderModelTestResult> {
  const complete = dependencies.completeModelText ?? completeModelText;
  const apiKey = (await dependencies.resolveSecret(provider)) ?? undefined;
  const signal = AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS);
  const startedAt = Date.now();
  const chatApi = resolveEffectiveChatApi(provider);
  try {
    await complete(
      {
        model: { providerId: provider.id, modelId },
        systemPrompt: 'Reply with the single word: pong',
        userPrompt: 'ping',
        maxOutputTokens: 256,
        signal,
      },
      { provider, ...(apiKey ? { apiKey } : {}) },
    );
  } catch (error) {
    if (signal.aborted) {
      throw new ProviderModelDiscoveryError('Model test timed out after 20 seconds', {
        kind: 'timeout',
      });
    }
    throw new ProviderModelDiscoveryError(
      `Model test failed: ${formatError(error)} (check ${
        provider.protocol === 'google-vertex'
          ? 'gcloud ADC login, project and location'
          : 'AWS credentials, region and model access'
      })`,
      { kind: 'network' },
    );
  }
  return {
    providerId: provider.id,
    modelId,
    durationMs: Date.now() - startedAt,
    chatApi,
    endpoint: provider.protocol,
  };
}
