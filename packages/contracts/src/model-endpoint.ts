/**
 * Per-model request protocol (ADR 0079).
 *
 * A model may speak a different wire format than its provider row (one
 * multi-format gateway, several formats). This module is the only place that
 * derives a model's effective protocol, base URL and chat transport; Host
 * lookups hand consumers the resulting provider-shaped view.
 */
import type { ModelConfigEntry, ModelProviderConfig, ProviderChatApi } from './config.js';
import { isSubscriptionProvider } from './subscription-oauth.js';

type ProviderProtocol = ModelProviderConfig['protocol'];

const PROVIDER_PROTOCOLS: readonly ProviderProtocol[] = [
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
];

export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return typeof value === 'string' && (PROVIDER_PROTOCOLS as readonly string[]).includes(value);
}

/** The protocol this model's requests use. Subscriptions keep their fixed wire. */
export function resolveModelProtocol(
  provider: Pick<ModelProviderConfig, 'protocol' | 'source'>,
  model: Pick<ModelConfigEntry, 'protocol'> | undefined,
): ProviderProtocol {
  const override = model?.protocol;
  if (!override || !isProviderProtocol(override) || isSubscriptionProvider(provider)) {
    return provider.protocol;
  }
  return override;
}

/**
 * Provider-shaped view of `provider` as seen by `model`: effective protocol,
 * base URL re-versioned for that protocol, and a chat transport that belongs
 * to it. Returns `provider` itself when the model inherits its protocol.
 */
export function resolveModelEndpoint(
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
  return resolveModelEndpoint(provider, model).chatApi;
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
      return root;
  }
}
