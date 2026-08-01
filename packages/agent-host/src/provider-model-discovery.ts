/**
 * Host-owned provider model discovery.
 *
 * The desktop never sends credentials over the network. It asks the host to
 * call the protocol-specific discovery endpoint using a resolved secret.
 */
import type { DiscoveredModel, ModelDiscoveryResult, ModelProviderConfig } from '@piwin/contracts';
import { enrichFromCatalog, lookupCatalogByModelId } from './model-catalog-reader.js';

const DISCOVERY_TIMEOUT_MS = 15_000;
const ANTHROPIC_API_VERSION = '2023-06-01';

export type ProviderModelDiscoveryDependencies = {
  fetch?: typeof globalThis.fetch;
  /** Return null when the endpoint needs no auth (local gateway). */
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>;
};

export class ProviderModelDiscoveryError extends Error {
  readonly name = 'ProviderModelDiscoveryError';

  constructor(message: string) {
    super(message);
  }
}

export async function discoverProviderModels(
  provider: ModelProviderConfig,
  dependencies: ProviderModelDiscoveryDependencies,
): Promise<ModelDiscoveryResult> {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new ProviderModelDiscoveryError('Model discovery is unavailable: fetch is not supported');
  }

  const endpoint = buildDiscoveryEndpoint(provider);
  const headers = await buildProviderRequestHeaders(provider, dependencies.resolveSecret);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(endpoint, {
      method: 'GET',
      headers,
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new ProviderModelDiscoveryError(
        `Model discovery failed (${response.status} ${response.statusText || 'request rejected'})`,
      );
    }
    const payload: unknown = await response.json();
    const models = parseDiscoveredModels(provider.protocol, payload).map((model) =>
      enrichDiscoveredModelFromCatalog(model),
    );
    return { providerId: provider.id, protocol: provider.protocol, models };
  } catch (error) {
    if (error instanceof ProviderModelDiscoveryError) {
      throw error;
    }
    if (abortController.signal.aborted) {
      throw new ProviderModelDiscoveryError('Model discovery timed out after 15 seconds');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderModelDiscoveryError(`Model discovery failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function buildDiscoveryEndpoint(provider: ModelProviderConfig): string {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new ProviderModelDiscoveryError('Model discovery requires a Base URL');
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('not HTTP');
    }
  } catch {
    throw new ProviderModelDiscoveryError('Model discovery requires a valid http(s) Base URL');
  }

  if (provider.protocol === 'google-gemini') {
    return `${baseUrl}/models`;
  }
  return baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

export async function buildProviderRequestHeaders(
  provider: ModelProviderConfig,
  resolveSecret: ProviderModelDiscoveryDependencies['resolveSecret'],
): Promise<Headers> {
  const headers = new Headers({ accept: 'application/json' });
  const secret = await resolveSecret(provider);
  if (!secret) {
    applyCustomHeaders(headers, provider.headers);
    return headers;
  }

  if (provider.protocol === 'anthropic-compatible') {
    headers.set('x-api-key', secret);
    headers.set('anthropic-version', ANTHROPIC_API_VERSION);
    applyCustomHeaders(headers, provider.headers);
    return headers;
  }
  if (provider.protocol === 'google-gemini') {
    headers.set('x-goog-api-key', secret);
    applyCustomHeaders(headers, provider.headers);
    return headers;
  }
  headers.set('authorization', `Bearer ${secret}`);
  applyCustomHeaders(headers, provider.headers);
  return headers;
}

/**
 * Apply user-configured headers last so gateway-specific fields can be set.
 * Auth headers already set by protocol are not overwritten.
 */
function applyCustomHeaders(
  headers: Headers,
  customHeaders: ModelProviderConfig['headers'] | undefined,
): void {
  if (!customHeaders) {
    return;
  }
  const protectedNames = new Set([
    'authorization',
    'x-api-key',
    'x-goog-api-key',
    'anthropic-version',
  ]);
  for (const [rawName, rawValue] of Object.entries(customHeaders)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name || !value) {
      continue;
    }
    if (protectedNames.has(name.toLowerCase()) && headers.has(name)) {
      continue;
    }
    headers.set(name, value);
  }
}

function parseDiscoveredModels(
  protocol: ModelProviderConfig['protocol'],
  payload: unknown,
): DiscoveredModel[] {
  if (!isRecord(payload)) {
    throw new ProviderModelDiscoveryError('Model discovery returned an invalid response');
  }
  const rawModels = protocol === 'google-gemini' ? payload.models : payload.data;
  if (!Array.isArray(rawModels)) {
    throw new ProviderModelDiscoveryError('Model discovery response did not contain a model list');
  }

  const deduplicated = new Map<string, DiscoveredModel>();
  for (const rawModel of rawModels) {
    if (!isRecord(rawModel)) {
      continue;
    }
    const rawId = protocol === 'google-gemini' ? rawModel.name : rawModel.id;
    if (typeof rawId !== 'string') {
      continue;
    }
    const id = protocol === 'google-gemini' ? rawId.replace(/^models\//, '') : rawId.trim();
    if (!id) {
      continue;
    }
    const displayName = protocol === 'google-gemini' ? rawModel.displayName : rawModel.name;
    const model: DiscoveredModel = { id };
    if (typeof displayName === 'string' && displayName.trim() && displayName !== id) {
      model.label = displayName.trim();
    }
    deduplicated.set(id, model);
  }
  return [...deduplicated.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function enrichDiscoveredModelFromCatalog(model: DiscoveredModel): DiscoveredModel {
  return enrichFromCatalog(model, lookupCatalogByModelId(model.id));
}
