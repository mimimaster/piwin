/**
 * Provider-native web search request shaping + citation normalization (ADR 0043).
 *
 * agent-host wraps Pi provider `streamSimple` with an `onPayload` transform so
 * the Host can apply the resolved search policy without forking Pi.
 * Desktop never parses provider-native payloads; citations are normalized here.
 */

import type {
  ModelCapability,
  NativeSearchAdapterKind,
  ResolvedSearchRoute,
  SearchCitation,
  SearchEvidence,
} from '@piwin/contracts';
import { modelSupportsCapability } from '@piwin/contracts';

export type NativeSearchModelFlags = {
  id: string;
  capabilities?: readonly ModelCapability[];
  /** Declared request-shaping mechanism; takes precedence over api sniffing. */
  nativeSearchAdapter?: NativeSearchAdapterKind;
};

export type NativeSearchStreamOptions = {
  onPayload?: (
    payload: unknown,
    model: { id?: string; api?: string; provider?: string },
  ) => unknown | undefined | Promise<unknown | undefined>;
  [key: string]: unknown;
};

export type NativeSearchStreamSimple = (
  model: { id?: string; api?: string; provider?: string; [key: string]: unknown },
  context: unknown,
  options?: NativeSearchStreamOptions,
) => unknown;

/**
 * Whether this registration should wrap streamSimple for native search policy
 * shaping. True when any model is tagged native-web-search or the resolved
 * route needs provider-native fields to be injected or removed.
 */
export function providerNeedsNativeSearchWrapper(
  models: readonly NativeSearchModelFlags[],
  searchRoute?: ResolvedSearchRoute | null,
): boolean {
  if (searchRoute?.selected === 'native' || searchRoute?.selected === 'external') {
    return true;
  }
  return models.some((model) =>
    modelSupportsCapability(
      { ...(model.capabilities ? { capabilities: [...model.capabilities] } : {}) },
      'native-web-search',
    ),
  );
}

/**
 * Decide if provider-native search fields should be present for one request.
 */
export function resolveNativeSearchEnabledForModel(
  model: NativeSearchModelFlags | undefined,
  searchRoute?: ResolvedSearchRoute | null,
): boolean {
  if (!model) {
    return searchRoute?.selected === 'native';
  }
  const tagged = modelSupportsCapability(
    { ...(model.capabilities ? { capabilities: [...model.capabilities] } : {}) },
    'native-web-search',
  );
  if (!tagged) {
    return false;
  }
  return searchRoute?.selected === 'native';
}

/**
 * Inject or strip provider-native web search fields on an outbound payload.
 *
 * A declared {@link NativeSearchAdapterKind} selects the wire mechanism
 * explicitly (a protocol match alone does not prove a vendor gateway accepts
 * the generic fields); without one, the legacy `modelApi` sniffing applies.
 *
 * Supported shapes:
 * - OpenAI-compatible: `web_search_options` / `tools: [{ type: 'web_search*' }]`
 * - Anthropic: tools entry `web_search` / `web_search_20250305`
 * - Google: `config.tools: [{ googleSearch: {} }]`
 */
export function applyNativeSearchToPayload(
  payload: unknown,
  enabled: boolean,
  modelApi?: string,
  nativeSearchAdapter?: NativeSearchAdapterKind,
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const record = { ...(payload as Record<string, unknown>) };
  const api = (modelApi ?? '').toLowerCase();

  if (enabled) {
    switch (nativeSearchAdapter) {
      case 'openai-web-search-options':
        ensureOpenAiCompletionsWebSearch(record);
        break;
      case 'openai-responses-tool':
        ensureOpenAiResponsesWebSearchTool(record);
        break;
      case 'anthropic-web-search-tool':
        ensureAnthropicWebSearchTool(record);
        break;
      case 'google-search-tool':
        ensureGoogleSearchTool(record);
        break;
      case 'vendor-specific':
        // The generic adapter cannot express this vendor's mechanism; the
        // route resolver already reports native search as unsupported for
        // such models. Never guess a wire shape here.
        break;
      case undefined:
        if (api.includes('anthropic')) {
          ensureAnthropicWebSearchTool(record);
        } else if (api.includes('google')) {
          ensureGoogleSearchTool(record);
        } else if (api.includes('responses')) {
          ensureOpenAiResponsesWebSearchTool(record);
        } else {
          ensureOpenAiCompletionsWebSearch(record);
        }
        break;
    }
    return record;
  }

  // Remove native search fields when the resolved policy selects external (or none).
  delete record.web_search_options;
  delete record.webSearchOptions;
  stripNativeSearchTools(record);
  if (record.config && typeof record.config === 'object' && !Array.isArray(record.config)) {
    const config = { ...(record.config as Record<string, unknown>) };
    stripNativeSearchTools(config);
    record.config = config;
  }
  if (record.tool_config && typeof record.tool_config === 'object') {
    const toolConfig = { ...(record.tool_config as Record<string, unknown>) };
    if (toolConfig.function_calling_config) {
      // leave function calling alone; only strip search-specific google tools above
    }
    record.tool_config = toolConfig;
  }
  return record;
}

function ensureOpenAiCompletionsWebSearch(record: Record<string, unknown>): void {
  if (!record.web_search_options && !record.webSearchOptions) {
    record.web_search_options = {};
  }
}

function ensureOpenAiResponsesWebSearchTool(record: Record<string, unknown>): void {
  const tools = Array.isArray(record.tools) ? [...record.tools] : [];
  const hasSearchTool = tools.some((tool) => isNativeSearchTool(tool));
  if (!hasSearchTool) {
    tools.push({ type: 'web_search_preview' });
    record.tools = tools;
  }
}

function ensureAnthropicWebSearchTool(record: Record<string, unknown>): void {
  const tools = Array.isArray(record.tools) ? [...record.tools] : [];
  if (!tools.some((tool) => isNativeSearchTool(tool))) {
    tools.push({ type: 'web_search_20250305', name: 'web_search' });
    record.tools = tools;
  }
}

function ensureGoogleSearchTool(record: Record<string, unknown>): void {
  const config =
    record.config && typeof record.config === 'object' && !Array.isArray(record.config)
      ? { ...(record.config as Record<string, unknown>) }
      : {};
  const tools = Array.isArray(config.tools) ? [...config.tools] : [];
  if (!tools.some((tool) => isNativeSearchTool(tool))) {
    // @google/genai uses camelCase request properties. Its wire serializer
    // converts this to the provider's google_search field.
    tools.push({ googleSearch: {} });
    config.tools = tools;
  }
  record.config = config;
}

function stripNativeSearchTools(record: Record<string, unknown>): void {
  if (!Array.isArray(record.tools)) {
    return;
  }
  const filtered = record.tools.filter((tool) => !isNativeSearchTool(tool));
  if (filtered.length === 0) {
    delete record.tools;
  } else {
    record.tools = filtered;
  }
}

function isNativeSearchTool(tool: unknown): boolean {
  if (!tool || typeof tool !== 'object') {
    return false;
  }
  const record = tool as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (type.includes('web_search') || type.includes('web-search')) {
    return true;
  }
  if (
    'google_search' in record ||
    'googleSearch' in record ||
    'google_search_retrieval' in record
  ) {
    return true;
  }
  return false;
}

/**
 * Wrap a provider streamSimple so every request applies the resolved search
 * policy for the active model.
 */
export function wrapStreamSimpleForNativeSearch(
  baseStreamSimple: NativeSearchStreamSimple | undefined,
  options: {
    models: readonly NativeSearchModelFlags[];
    searchRoute?: ResolvedSearchRoute | null;
    /**
     * Fallback streamSimple used when the registration has no custom stream.
     * Typically the Pi runtime default obtained after registration.
     */
    fallbackStreamSimple?: NativeSearchStreamSimple;
  },
): NativeSearchStreamSimple | undefined {
  const underlying = baseStreamSimple ?? options.fallbackStreamSimple;
  if (!underlying) {
    return undefined;
  }
  const modelsById = new Map(options.models.map((model) => [model.id, model]));

  return (model, context, streamOptions) => {
    const modelId = typeof model?.id === 'string' ? model.id : undefined;
    const flags = modelId ? modelsById.get(modelId) : undefined;
    const enabled = resolveNativeSearchEnabledForModel(flags, options.searchRoute);
    const modelApi = typeof model?.api === 'string' ? model.api : undefined;
    const previousOnPayload = streamOptions?.onPayload;

    const nextOptions: NativeSearchStreamOptions = {
      ...(streamOptions ?? {}),
      onPayload: async (payload, payloadModel) => {
        let nextPayload = applyNativeSearchToPayload(
          payload,
          enabled,
          modelApi ?? payloadModel?.api,
          flags?.nativeSearchAdapter,
        );
        if (previousOnPayload) {
          const replaced = await previousOnPayload(nextPayload, payloadModel);
          if (replaced !== undefined) {
            nextPayload = replaced;
          }
        }
        return nextPayload;
      },
    };

    return underlying(model, context, nextOptions);
  };
}

/**
 * Normalize provider-native grounding / annotation metadata into product
 * SearchEvidence. Returns undefined when no citations are present.
 */
export function normalizeNativeSearchCitations(raw: unknown): SearchEvidence | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const citations: SearchCitation[] = [];

  // OpenAI-style annotations, Google grounding metadata, and provider-neutral
  // citation arrays are all reduced to the same product shape here. Desktop
  // receives only this normalized shape and never sees the provider payload.
  collectFromAnnotations(record.annotations, citations);
  collectFromAnnotations(record.citation, citations);
  collectFromGroundingMetadata(record.groundingMetadata ?? record.grounding_metadata, citations);
  collectFromCitationsArray(record.citations, citations);
  collectFromCitationsArray(record.sources, citations);
  collectFromContent(record.content, citations);
  collectFromOutput(record.output, citations);

  if (citations.length === 0) {
    return undefined;
  }

  const evidence: SearchEvidence = {
    provenance: 'native',
    citations: dedupeCitations(citations),
  };
  const query = readSearchQuery(record);
  if (query !== undefined) {
    evidence.query = query;
  }
  return evidence;
}

function collectFromContent(value: unknown, citations: SearchCitation[]): void {
  if (!Array.isArray(value)) return;
  for (const part of value) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    collectFromAnnotations(record.annotations, citations);
    collectFromAnnotations(record.citation, citations);
    collectFromCitationsArray(record.citations, citations);
    collectFromCitationsArray(record.sources, citations);
  }
}

function collectFromOutput(value: unknown, citations: SearchCitation[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    collectFromAnnotations(record.annotations, citations);
    collectFromAnnotations(record.citation, citations);
    collectFromCitationsArray(record.citations, citations);
    collectFromCitationsArray(record.sources, citations);
    collectFromContent(record.content, citations);
  }
}

function collectFromAnnotations(value: unknown, citations: SearchCitation[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const urlCitation = asRecord(record.url_citation);
    const url = firstString(record.url, record.uri, urlCitation?.url);
    if (url === undefined) continue;
    const title = firstString(record.title, urlCitation?.title);
    const snippet = firstString(
      record.snippet,
      record.quote,
      record.cited_text,
      urlCitation?.snippet,
    );
    appendNativeCitation(citations, { url, title, snippet });
  }
}

function collectFromGroundingMetadata(value: unknown, citations: SearchCitation[]): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const chunks = record.groundingChunks ?? record.grounding_chunks;
  if (!Array.isArray(chunks)) return;
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    const chunkRecord = chunk as Record<string, unknown>;
    const web = asRecord(chunkRecord.web) ?? asRecord(chunkRecord.retrievedContext) ?? chunkRecord;
    if (!web) continue;
    const url = firstString(web.uri, web.url);
    if (url === undefined) continue;
    appendNativeCitation(citations, {
      url,
      title: firstString(web.title),
      snippet: firstString(web.snippet, web.description),
    });
  }
}

function collectFromCitationsArray(value: unknown, citations: SearchCitation[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourceRecord = asRecord(record.source);
    const url = firstString(record.url, record.uri, sourceRecord?.url, sourceRecord?.uri);
    if (url === undefined) continue;
    appendNativeCitation(citations, {
      url,
      title: firstString(record.title, record.name, sourceRecord?.title),
      snippet: firstString(record.snippet, record.quote, record.cited_text, sourceRecord?.snippet),
      source: firstString(record.source, sourceRecord?.name),
    });
  }
}

function appendNativeCitation(
  citations: SearchCitation[],
  fields: { url: unknown; title?: unknown; snippet?: unknown; source?: unknown },
): void {
  if (typeof fields.url !== 'string') return;
  const url = fields.url.trim();
  if (!isSafeCitationUrl(url)) return;
  const title = stringValue(fields.title) ?? url;
  const snippet = stringValue(fields.snippet);
  const source = stringValue(fields.source);
  citations.push({
    title,
    url,
    ...(snippet !== undefined ? { snippet } : {}),
    ...(source !== undefined ? { source } : {}),
    provenance: 'native',
  });
}

function isSafeCitationUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function readSearchQuery(record: Record<string, unknown>): string | undefined {
  const grounding = asRecord(record.groundingMetadata ?? record.grounding_metadata);
  const query = firstString(
    record.query,
    record.searchQuery,
    record.search_query,
    record.searchQueries,
    record.search_queries,
    record.queries,
    grounding?.webSearchQueries,
    grounding?.web_search_queries,
  );
  return query;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested !== undefined) return nested;
      continue;
    }
    const normalized = stringValue(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function dedupeCitations(citations: readonly SearchCitation[]): SearchCitation[] {
  const seen = new Set<string>();
  const result: SearchCitation[] = [];
  for (const citation of citations) {
    const key = citation.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}
