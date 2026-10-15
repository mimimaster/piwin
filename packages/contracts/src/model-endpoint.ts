/**
 * Per-model request protocol (ADR 0079).
 *
 * A model may speak a different wire format than its provider row (one
 * multi-format gateway, several formats). This module is the only place that
 * derives a model's effective protocol, base URL, chat transport and request
 * headers (provider headers overlaid by the model's own); Host
 * lookups hand consumers the resulting provider-shaped view.
 */
import type { ModelConfigEntry, ModelProviderConfig, ProviderChatApi } from './config.js';
import { isCloudCredentialProtocol } from './config.js';
import { isSubscriptionProvider } from './subscription-oauth.js';

type ProviderProtocol = ModelProviderConfig['protocol'];

const PROVIDER_PROTOCOLS: readonly ProviderProtocol[] = [
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
  'google-vertex',
  'amazon-bedrock',
];

export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return typeof value === 'string' && (PROVIDER_PROTOCOLS as readonly string[]).includes(value);
}

/**
 * Whether models on this provider may pick their own request protocol.
 * Subscriptions keep their fixed wire. Cloud platforms (Vertex AI, Bedrock)
 * carry their own auth and endpoint, so a per-model hop into or out of them
 * through a shared gateway URL is not meaningful.
 */
export function supportsModelProtocolOverride(
  provider: Pick<ModelProviderConfig, 'protocol' | 'source'>,
): boolean {
  return !isSubscriptionProvider(provider) && !isCloudCredentialProtocol(provider.protocol);
}

/** The protocol this model's requests use (see {@link supportsModelProtocolOverride}). */
export function resolveModelProtocol(
  provider: Pick<ModelProviderConfig, 'protocol' | 'source'>,
  model: Pick<ModelConfigEntry, 'protocol'> | undefined,
): ProviderProtocol {
  const override = model?.protocol;
  if (
    !override ||
    !isProviderProtocol(override) ||
    isCloudCredentialProtocol(override) ||
    !supportsModelProtocolOverride(provider)
  ) {
    return provider.protocol;
  }
  return override;
}

/**
 * Provider headers overlaid by the model's own. HTTP header names are
 * case-insensitive, so a model header replaces any provider header of the
 * same name regardless of spelling. Undefined when neither sets any.
 */
export function resolveModelHeaders(
  provider: Pick<ModelProviderConfig, 'headers'>,
  model: Pick<ModelConfigEntry, 'headers'> | undefined,
): Record<string, string> | undefined {
  const own = model?.headers;
  if (!own || Object.keys(own).length === 0) return provider.headers;
  const merged: Record<string, string> = { ...provider.headers };
  for (const [name, value] of Object.entries(own)) {
    const lower = name.toLowerCase();
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === lower) delete merged[existing];
    }
    merged[name] = value;
  }
  return merged;
}

/**
 * Provider-shaped view of `provider` as seen by `model`: effective protocol,
 * base URL re-versioned for that protocol, a chat transport that belongs to
 * it, and the merged request headers. Returns `provider` itself when the
 * model inherits both its protocol and its headers.
 */
export function resolveModelEndpoint(
  provider: ModelProviderConfig,
  model: Pick<ModelConfigEntry, 'protocol' | 'headers'> | undefined,
): ModelProviderConfig {
  const view = resolveModelProtocolView(provider, model);
  const headers = resolveModelHeaders(provider, model);
  if (headers === provider.headers) return view;
  return headers ? { ...view, headers } : view;
}

function resolveModelProtocolView(
  provider: ModelProviderConfig,
  model: Pick<ModelConfigEntry, 'protocol'> | undefined,
): ModelProviderConfig {
  const protocol = resolveModelProtocol(provider, model);
  if (protocol === provider.protocol) {
    return provider;
  }
  const { chatApi: _providerChatApi, ...rest } = provider;
  const baseUrl = rebaseForProtocol(provider.baseUrl, protocol);
  switch (protocol) {
    case 'openai-compatible':
      return { ...rest, protocol, baseUrl };
    case 'anthropic-compatible':
      return { ...rest, protocol, baseUrl };
    case 'google-gemini':
      return { ...rest, protocol, baseUrl };
    // Unreachable: resolveModelProtocol never yields a cloud override.
    case 'google-vertex':
    case 'amazon-bedrock':
      return provider;
  }
}

/** {@link resolveModelEndpoint} for a model id on `provider` (unknown id → provider). */
export function resolveModelEndpointById(
  provider: ModelProviderConfig,
  modelId: string,
): ModelProviderConfig {
  return resolveModelEndpoint(
    provider,
    provider.models.find((model) => model.id === modelId),
  );
}

/** Effective chat transport for a model (provider `chatApi` only when inherited). */
export function resolveModelChatApi(
  provider: ModelProviderConfig,
  model: Pick<ModelConfigEntry, 'protocol'> | undefined,
): ProviderChatApi | undefined {
  return resolveModelProtocolView(provider, model).chatApi;
}

const VERSION_SUFFIX = /\/v1(?:beta|alpha)?$/iu;

/**
 * Re-version a gateway base URL for another wire format: drop a trailing
 * `/v1`, `/v1beta` or `/v1alpha`, then append what the target client expects.
 * The Anthropic client appends `/v1/messages` itself, so it gets the root.
 */
export function rebaseForProtocol(baseUrl: string, protocol: ProviderProtocol): string {
  const root = baseUrl.trim().replace(/\/+$/u, '').replace(VERSION_SUFFIX, '');
  switch (protocol) {
    case 'openai-compatible':
      return `${root}/v1`;
    case 'google-gemini':
      return `${root}/v1beta`;
    case 'anthropic-compatible':
    case 'google-vertex':
    case 'amazon-bedrock':
      return root;
  }
}
