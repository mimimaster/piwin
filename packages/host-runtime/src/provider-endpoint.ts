/**
 * One URL rule for every Host-owned call to a configured model provider.
 *
 * Invariant: a probe (Test connection, single-model test) and a Host-side
 * auxiliary completion must hit the *same* URL that Pi's runtime hits for the
 * same provider row. Pi hands `provider.baseUrl` verbatim to the vendor SDKs:
 *
 * - OpenAI SDK (`openai-completions` / `openai-responses`): `{baseUrl}/chat/completions`
 *   or `{baseUrl}/responses` — no `/v1` is ever inserted, so `/api/plan/v3`,
 *   `/api/paas/v4`, `/compatible-mode/v1` all work as typed.
 * - Anthropic SDK (`anthropic-messages`): `{baseUrl}/v1/messages` — the SDK
 *   path already carries `/v1`.
 * - Google GenAI (`google-generative-ai`): `{baseUrl}/models/{id}:generateContent`
 *   with the API version taken from the Base URL.
 *
 * Before this module each caller guessed (`endsWith('/v1')`, `/v\d+$/`), so a
 * probe could report failure for a config that chats fine, or success for one
 * that cannot. Model *discovery* is the one deliberate exception: it only
 * imports a catalog, so it keeps its lenient `/v1/models` fallback.
 */
import type { ModelProviderConfig, ProviderChatApi } from '@piwin/contracts';
import { resolveProviderChatApi } from '@piwin/contracts';

export class ProviderEndpointError extends Error {
  readonly name = 'ProviderEndpointError';

  constructor(message: string) {
    super(message);
  }
}

/** Trimmed Base URL without trailing slashes; throws when it is not http(s). */
export function normalizeProviderBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new ProviderEndpointError('Provider requires a Base URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ProviderEndpointError(`Provider Base URL is not a valid URL: ${normalized}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderEndpointError(`Provider Base URL must be http(s): ${normalized}`);
  }
  return normalized;
}

/**
 * The chat transport Pi actually uses for this provider. `openai-responses`
 * is only meaningful on OpenAI-compatible rows; anything else falls back to
 * the protocol default so a stray value can never pick an impossible wire.
 */
export function resolveEffectiveChatApi(
  provider: Pick<ModelProviderConfig, 'protocol'> & { chatApi?: ProviderChatApi },
): ProviderChatApi {
  const chatApi = resolveProviderChatApi(provider);
  switch (provider.protocol) {
    case 'openai-compatible':
      return chatApi === 'openai-responses' ? 'openai-responses' : 'openai-completions';
    case 'anthropic-compatible':
      return 'anthropic-messages';
    case 'google-gemini':
      return 'google-generative-ai';
    case 'google-vertex':
      return 'google-vertex';
    case 'amazon-bedrock':
      return 'bedrock-converse-stream';
  }
}

/** URL of one non-streaming generation request, identical to Pi's runtime URL. */
export function resolveProviderChatEndpoint(
  provider: Pick<ModelProviderConfig, 'protocol' | 'baseUrl'> & { chatApi?: ProviderChatApi },
  modelId: string,
  chatApi: ProviderChatApi = resolveEffectiveChatApi(provider),
): string {
  if (chatApi === 'google-vertex' || chatApi === 'bedrock-converse-stream') {
    // Vertex/Bedrock need platform auth (ADC / SigV4); only Pi's SDK transport talks to them.
    throw new ProviderEndpointError(
      `${provider.protocol} has no plain HTTP endpoint; it is served by the Pi SDK transport only`,
    );
  }
  const baseUrl = normalizeProviderBaseUrl(provider.baseUrl);
  switch (chatApi) {
    case 'openai-completions':
      return `${baseUrl}/chat/completions`;
    case 'openai-responses':
      return `${baseUrl}/responses`;
    case 'anthropic-messages':
      return `${baseUrl}/v1/messages`;
    case 'google-generative-ai':
      return `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
  }
}
