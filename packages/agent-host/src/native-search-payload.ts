/**
 * Provider-native web search request shaping (ADR 0043). Pure payload
 * transforms applied through Pi's `onPayload` hook. Search activation lives
 * in request bodies only; see `native-search-headers.ts` for header policy.
 */
import type {
  AnthropicWebSearchToolType,
  NativeSearchAdapterKind,
  NativeSearchAdapterOptions,
} from '@piwin/contracts';

/** Upper bound on hosted searches per Anthropic sub-request. */
export const ANTHROPIC_WEB_SEARCH_MAX_USES = 5;

const DEFAULT_ANTHROPIC_TOOL_TYPE: AnthropicWebSearchToolType = 'web_search_20250305';
const OPENAI_SOURCES_INCLUDE = 'web_search_call.action.sources';

/**
 * Inject the provider-native web search request shape into an outbound
 * payload for the Host `web_search` native sub-request.
 *
 * The {@link NativeSearchAdapterKind} selects the wire mechanism; the caller
 * passes the adapter it already resolved (declared or inferred). Without one
 * nothing is injected (fail closed).
 */
export function applyNativeSearchToPayload(
  payload: unknown,
  nativeSearchAdapter: NativeSearchAdapterKind | undefined,
  adapterOptions?: NativeSearchAdapterOptions,
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const record = { ...(payload as Record<string, unknown>) };
  switch (nativeSearchAdapter) {
    case 'openai-web-search-options':
      if (!record.web_search_options && !record.webSearchOptions) record.web_search_options = {};
      break;
    case 'openai-responses-tool':
      ensureResponsesWebSearchTool(record, adapterOptions?.openaiResponses?.includeSources ?? true);
      break;
    case 'xai-web-search-tool':
      // Same Responses tool name; `x_search` is never enabled implicitly.
      ensureResponsesWebSearchTool(record, true);
      break;
    case 'anthropic-web-search-tool':
      ensureAnthropicWebSearchTool(record, adapterOptions?.anthropic);
      break;
    case 'google-search-tool':
      ensureGoogleSearchTool(record);
      break;
    case undefined:
      break;
  }
  return record;
}

function ensureResponsesWebSearchTool(record: Record<string, unknown>, includeSources: boolean): void {
  const tools = Array.isArray(record.tools) ? [...record.tools] : [];
  if (!tools.some((tool) => isNativeSearchTool(tool))) {
    tools.push({ type: 'web_search' });
    record.tools = tools;
  }
  if (includeSources) {
    const include = Array.isArray(record.include) ? [...record.include] : [];
    if (!include.includes(OPENAI_SOURCES_INCLUDE)) include.push(OPENAI_SOURCES_INCLUDE);
    record.include = include;
  }
}

function ensureAnthropicWebSearchTool(
  record: Record<string, unknown>,
  options: NativeSearchAdapterOptions['anthropic'],
): void {
  const tools = Array.isArray(record.tools) ? [...record.tools] : [];
  if (tools.some((tool) => isNativeSearchTool(tool))) return;
  const type = options?.toolType ?? DEFAULT_ANTHROPIC_TOOL_TYPE;
  const allowedCallers =
    options?.allowedCallers ?? (type === 'web_search_20250305' ? undefined : ['direct']);
  tools.push({
    type,
    name: 'web_search',
    max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES,
    ...(allowedCallers ? { allowed_callers: [...allowedCallers] } : {}),
  });
  record.tools = tools;
}

function ensureGoogleSearchTool(record: Record<string, unknown>): void {
  const config =
    record.config && typeof record.config === 'object' && !Array.isArray(record.config)
      ? { ...(record.config as Record<string, unknown>) }
      : {};
  const tools = Array.isArray(config.tools) ? [...config.tools] : [];
  if (!tools.some((tool) => isNativeSearchTool(tool))) {
    // @google/genai camelCase; its serializer emits `google_search` on the wire.
    tools.push({ googleSearch: {} });
    config.tools = tools;
  }
  record.config = config;
}

/** Hosted (provider-executed) search tool — never a client function tool. */
export function isNativeSearchTool(tool: unknown): boolean {
  if (!tool || typeof tool !== 'object') return false;
  const record = tool as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (type.startsWith('web_search') || type.includes('web-search')) return true;
  return 'google_search' in record || 'googleSearch' in record || 'google_search_retrieval' in record;
}
