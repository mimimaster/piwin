/**
 * Host-owned provider model discovery.
 *
 * The desktop never sends credentials over the network. It asks the host to
 * call the protocol-specific discovery endpoint using a resolved secret.
 */
import type {
  DiscoveredModel,
  ModelCapability,
  ModelDiscoveryResult,
  ModelProviderConfig,
} from '@piwin/contracts';
import {
  applyDiscoveredNativeSearch,
  formatError,
  isLikelyImageGenerationModel,
  isLikelyRealtimeAudioModel,
  isLikelyVideoGenerationModel,
  lookupImageGenerationRegistry,
  lookupVideoGenerationRegistry,
  matchImageCatalog,
} from '@piwin/contracts';
import {
  enrichFromCatalog,
  lookupCatalogByModelId,
  searchPiImagesCatalog,
} from '@piwin/agent-host';
import { readExplicitVideoGenerationMetadata } from './provider-model-capabilities.js';
import { formatProviderHttpFailure } from './provider-http-failure.js';
import type { ExplicitVideoGenerationMetadata } from './provider-model-capabilities.js';

const DISCOVERY_TIMEOUT_MS = 15_000;
const ANTHROPIC_API_VERSION = '2023-06-01';

export type ProviderModelDiscoveryDependencies = {
  fetch?: typeof globalThis.fetch;
  /** Return null when the endpoint needs no auth (local gateway). */
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>;
};

/**
 * Why a discovery / probe request failed. The connection test maps these to
 * a user verdict, so an HTTP 404 from a catalog-less endpoint is never
 * confused with a DNS/TLS failure.
 */
export type ProviderProbeFailureKind =
  | 'config'
  | 'http'
  | 'network'
  | 'timeout'
  | 'invalid-response';

export class ProviderModelDiscoveryError extends Error {
  readonly name = 'ProviderModelDiscoveryError';
  readonly failureKind: ProviderProbeFailureKind;
  readonly httpStatus: number | undefined;

  constructor(
    message: string,
    failure: { kind: ProviderProbeFailureKind; httpStatus?: number } = { kind: 'config' },
  ) {
    super(message);
    this.failureKind = failure.kind;
    this.httpStatus = failure.httpStatus;
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
        `Model discovery failed (${await formatProviderHttpFailure(response)})`,
        { kind: 'http', httpStatus: response.status },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderModelDiscoveryError('Model discovery returned a non-JSON response', {
        kind: 'invalid-response',
        httpStatus: response.status,
      });
    }
    const models = parseDiscoveredModels(provider.protocol, payload).map(
      ({ model, videoMetadata }) =>
        enrichDiscoveredModelFromCatalog(model, provider, videoMetadata),
    );
    return { providerId: provider.id, protocol: provider.protocol, models };
  } catch (error) {
    if (error instanceof ProviderModelDiscoveryError) {
      throw error;
    }
    if (abortController.signal.aborted) {
      throw new ProviderModelDiscoveryError('Model discovery timed out after 15 seconds', {
        kind: 'timeout',
      });
    }
    const message = formatError(error);
    throw new ProviderModelDiscoveryError(`Model discovery failed: ${message}`, {
      kind: 'network',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Catalog URL. Lenient on purpose: see the discovery exception in provider-endpoint.ts. */
export function buildDiscoveryEndpoint(provider: ModelProviderConfig): string {
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
  return /\/v\d+$/i.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
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

type ParsedDiscoveredModel = {
  model: DiscoveredModel;
  videoMetadata: ExplicitVideoGenerationMetadata | undefined;
};

function parseDiscoveredModels(
  protocol: ModelProviderConfig['protocol'],
  payload: unknown,
): ParsedDiscoveredModel[] {
  if (!isRecord(payload)) {
    throw new ProviderModelDiscoveryError('Model discovery returned an invalid response', {
      kind: 'invalid-response',
    });
  }
  const rawModels = protocol === 'google-gemini' ? payload.models : payload.data;
  if (!Array.isArray(rawModels)) {
    throw new ProviderModelDiscoveryError(
      'Model discovery response did not contain a model list',
      { kind: 'invalid-response' },
    );
  }

  const deduplicated = new Map<string, ParsedDiscoveredModel>();
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
    deduplicated.set(id, {
      model,
      videoMetadata: readExplicitVideoGenerationMetadata(protocol, rawModel),
    });
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.model.id.localeCompare(right.model.id),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function enrichDiscoveredModelFromCatalog(
  model: DiscoveredModel,
  provider: Pick<ModelProviderConfig, 'protocol' | 'baseUrl'>,
  videoMetadata: ExplicitVideoGenerationMetadata | undefined,
): DiscoveredModel {
  const enriched = enrichFromCatalog(model, lookupCatalogByModelId(model.id));
  return applyDiscoveredNativeSearch(
    enrichRealtimeAudioCapability(
      enrichVideoGenerationCapability(
        enrichImageGenerationCapability(enriched),
        provider.protocol,
        videoMetadata,
      ),
    ),
    { protocol: provider.protocol, baseUrl: provider.baseUrl },
  );
}

/**
 * Auto-tag discovered image models so Image settings can list them.
 * Registry rows default to image-only; `chatSurface: true` and name/catalog
 * heuristics also keep `chat` so hybrid gateway models stay in the picker.
 */
function enrichImageGenerationCapability(model: DiscoveredModel): DiscoveredModel {
  if (isLikelyVideoGenerationModel(model.id, model.label, model.capabilities)) {
    return model;
  }
  const registryHit = lookupImageGenerationRegistry(model.id);
  const imageEntries = searchPiImagesCatalog().entries;
  const catalogMatched = matchImageCatalog(imageEntries, [model.id]).matched.length > 0;
  const heuristic = isLikelyImageGenerationModel(model.id, model.label, model.capabilities);
  if (!registryHit && !catalogMatched && !heuristic) {
    return model;
  }
  const capabilities = new Set<ModelCapability>(model.capabilities ?? []);
  capabilities.add('image-generation');
  const keepChat = registryHit ? registryHit.entry.chatSurface === true : true;
  if (keepChat) {
    capabilities.add('chat');
  }
  return { ...model, capabilities: [...capabilities] };
}

/**
 * Enrich discovered models with video-generation capability (ADR 0043).
 *
 * Provider metadata is the strongest declaration. Curated registry matches
 * preserve known defaults, while heuristics remain suggestions only.
 */
function enrichVideoGenerationCapability(
  model: DiscoveredModel,
  protocol: ModelProviderConfig['protocol'],
  videoMetadata: ExplicitVideoGenerationMetadata | undefined,
): DiscoveredModel {
  if (videoMetadata) {
    const capabilities = new Set<ModelCapability>(model.capabilities ?? []);
    capabilities.add('video-generation');
    return {
      ...model,
      capabilities: [...capabilities],
      videoGenerationSuggestion: {
        reason: 'provider',
        ...(videoMetadata.apiStyle ? { apiStyle: videoMetadata.apiStyle } : {}),
        ...(videoMetadata.path ? { path: videoMetadata.path } : {}),
      },
    };
  }

  const registryHit = lookupVideoGenerationRegistry(model.id, protocol);
  if (registryHit) {
    const capabilities = new Set<ModelCapability>(model.capabilities ?? []);
    capabilities.add('video-generation');
    const suggestion = {
      reason: 'registry' as const,
      apiStyle: registryHit.entry.apiStyle,
      ...(registryHit.entry.path ? { path: registryHit.entry.path } : {}),
      ...(registryHit.entry.label ? { label: registryHit.entry.label } : {}),
    };
    return {
      ...model,
      capabilities: [...capabilities],
      videoGenerationSuggestion: suggestion,
      ...(model.label || !registryHit.entry.label ? {} : { label: registryHit.entry.label }),
    };
  }

  if (isLikelyVideoGenerationModel(model.id, model.label, model.capabilities)) {
    return {
      ...model,
      videoGenerationSuggestion: {
        reason: 'heuristic',
        ...(model.label ? { label: model.label } : {}),
      },
    };
  }

  return model;
}

function enrichRealtimeAudioCapability(model: DiscoveredModel): DiscoveredModel {
  if (!isLikelyRealtimeAudioModel(model.id, model.label, model.capabilities)) {
    return model;
  }
  const capabilities = new Set<ModelCapability>(model.capabilities ?? []);
  capabilities.add('realtime-audio');
  return { ...model, capabilities: [...capabilities] };
}
