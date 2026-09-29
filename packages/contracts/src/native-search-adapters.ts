/**
 * Which native-search adapters a provider protocol can express (ADR 0043).
 * Shared by Host readiness and Desktop pickers so the two never disagree.
 *
 * The adapter is the wire shape of the Host `web_search` sub-request. It is
 * independent of the provider's ordinary chat transport: an openai-compatible
 * channel whose chatApi is completions can still execute
 * `openai-responses-tool` on `/responses`.
 */
import type {
  DiscoveredModel,
  ModelCapability,
  ModelProviderConfig,
  NativeSearchAdapterKind,
  ProviderChatApi,
} from './config.js';
import { SUBSCRIPTION_CHAT_SURFACES } from './subscription-chat-surface.js';

/** Adapters a user can pick, in display order. */
export const SELECTABLE_NATIVE_SEARCH_ADAPTERS: readonly NativeSearchAdapterKind[] = [
  'openai-responses-tool',
  'openai-web-search-options',
  'xai-web-search-tool',
  'anthropic-web-search-tool',
  'google-search-tool',
];

export function isNativeSearchAdapterKind(value: unknown): value is NativeSearchAdapterKind {
  return (
    typeof value === 'string' &&
    (SELECTABLE_NATIVE_SEARCH_ADAPTERS as readonly string[]).includes(value)
  );
}

/**
 * Adapters each vendor accepts. The vendor comes from an official base URL
 * first, otherwise from an unambiguous model-id family (a gateway such as
 * CLIProxyAPI still forwards `gemini-*` to Google). Only an unidentifiable
 * model on an unidentified gateway keeps every protocol-compatible shape.
 */
const VENDOR_NATIVE_SEARCH_ADAPTERS: Readonly<Record<NativeSearchVendor, readonly NativeSearchAdapterKind[]>> = {
  openai: ['openai-responses-tool', 'openai-web-search-options'],
  xai: ['xai-web-search-tool'],
  anthropic: ['anthropic-web-search-tool'],
  google: ['google-search-tool'],
};

/** Request protocol a vendor's native search needs. */
const VENDOR_SEARCH_PROTOCOL: Readonly<Record<NativeSearchVendor, ModelProviderConfig['protocol']>> = {
  openai: 'openai-compatible',
  xai: 'openai-compatible',
  anthropic: 'anthropic-compatible',
  google: 'google-gemini',
};

/** Vendor for native search: official host first, then model-id family. */
export function resolveNativeSearchVendor(input: {
  baseUrl?: string | undefined;
  modelId?: string | undefined;
}): NativeSearchVendor | undefined {
  return nativeSearchVendorFromBaseUrl(input.baseUrl) ?? nativeSearchVendorFromModelId(input.modelId);
}

/** Unambiguous model-id families only; anything else stays unidentified. */
export function nativeSearchVendorFromModelId(modelId: string | undefined): NativeSearchVendor | undefined {
  const id = modelId?.trim().toLowerCase().replace(/^.*\//u, '') ?? '';
  if (/^gemini-/u.test(id)) return 'google';
  if (/^grok-/u.test(id)) return 'xai';
  if (/^claude-/u.test(id)) return 'anthropic';
  if (/^(?:gpt-|chatgpt-|o\d)/u.test(id)) return 'openai';
  return undefined;
}

/**
 * The request protocol a model must use for native search when its current
 * protocol cannot express its vendor's search (e.g. `gemini-*` on an
 * OpenAI-compatible gateway row). Undefined when no switch is needed or the
 * vendor is unknown.
 */
export function nativeSearchProtocolSwitch(input: {
  protocol: ModelProviderConfig['protocol'];
  baseUrl?: string | undefined;
  modelId?: string | undefined;
}): ModelProviderConfig['protocol'] | undefined {
  const vendor = resolveNativeSearchVendor(input);
  if (!vendor) return undefined;
  const needed = VENDOR_SEARCH_PROTOCOL[vendor];
  return needed === input.protocol ? undefined : needed;
}

/** Whether `adapter` can be expressed on this protocol and for the model's vendor. */
export function isNativeSearchAdapterCompatible(
  protocol: ModelProviderConfig['protocol'] | undefined,
  _chatApi: ProviderChatApi | undefined,
  adapter: NativeSearchAdapterKind,
  baseUrl?: string,
  modelId?: string,
): boolean {
  if (!isProtocolCompatible(protocol, adapter)) return false;
  const vendor = resolveNativeSearchVendor({ baseUrl, modelId });
  return vendor === undefined || VENDOR_NATIVE_SEARCH_ADAPTERS[vendor].includes(adapter);
}

function isProtocolCompatible(
  protocol: ModelProviderConfig['protocol'] | undefined,
  adapter: NativeSearchAdapterKind,
): boolean {
  if (protocol === undefined) return false;
  switch (adapter) {
    case 'openai-web-search-options':
    case 'openai-responses-tool':
    case 'xai-web-search-tool':
      return protocol === 'openai-compatible';
    case 'anthropic-web-search-tool':
      return protocol === 'anthropic-compatible';
    case 'google-search-tool':
      return protocol === 'google-gemini';
    default:
      return false;
  }
}

/** Selectable adapters for a provider (Desktop picker filter). */
export function compatibleNativeSearchAdapters(
  protocol: ModelProviderConfig['protocol'] | undefined,
  chatApi?: ProviderChatApi,
  baseUrl?: string,
  modelId?: string,
): NativeSearchAdapterKind[] {
  return SELECTABLE_NATIVE_SEARCH_ADAPTERS.filter((adapter) =>
    isNativeSearchAdapterCompatible(protocol, chatApi, adapter, baseUrl, modelId),
  );
}

/**
 * Resolve the adapter a tagged model should use. An explicit saved value wins
 * when it is compatible; otherwise infer from protocol / official host / id.
 */
export function resolveNativeSearchAdapter(input: {
  protocol?: ModelProviderConfig['protocol'] | undefined;
  chatApi?: ProviderChatApi | undefined;
  baseUrl?: string | undefined;
  modelId?: string | undefined;
  nativeSearchAdapter?: NativeSearchAdapterKind | string | undefined;
}): NativeSearchAdapterKind | undefined {
  const declared = input.nativeSearchAdapter;
  if (typeof declared === 'string' && declared.trim()) {
    if (!isNativeSearchAdapterKind(declared)) return undefined;
    if (
      !isNativeSearchAdapterCompatible(
        input.protocol,
        input.chatApi,
        declared,
        input.baseUrl,
        input.modelId,
      )
    ) {
      return undefined;
    }
    return declared;
  }
  return inferNativeSearchAdapter(input);
}

/** Infer a wire adapter when the model is tagged but no adapter is saved. */
export function inferNativeSearchAdapter(input: {
  protocol?: ModelProviderConfig['protocol'] | undefined;
  chatApi?: ProviderChatApi | undefined;
  baseUrl?: string | undefined;
  modelId?: string | undefined;
}): NativeSearchAdapterKind | undefined {
  const protocol = input.protocol;
  // A known vendor whose search this protocol cannot express infers nothing
  // (fail closed) instead of guessing another vendor's shape.
  if (protocol && nativeSearchProtocolSwitch({ ...input, protocol }) !== undefined) return undefined;
  if (protocol === 'google-gemini') return 'google-search-tool';
  if (protocol === 'anthropic-compatible') return 'anthropic-web-search-tool';
  if (protocol !== 'openai-compatible') return undefined;
  const vendor = resolveNativeSearchVendor(input);
  if (vendor === 'xai') return 'xai-web-search-tool';
  if (isOpenAiSearchPreviewModelId(input.modelId)) return 'openai-web-search-options';
  return 'openai-responses-tool';
}

export type NativeSearchVendor = 'openai' | 'anthropic' | 'google' | 'xai';

/** `oauth://<id>` origins of Host-reachable subscriptions → their vendor. */
const SUBSCRIPTION_ORIGIN_VENDORS: Readonly<Record<string, NativeSearchVendor>> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_CHAT_SURFACES).map(([id, surface]) => [`oauth://${id}`, surface.vendor]),
);

/** Official vendor hosts only. Gateways and Azure stay untagged. */
export function nativeSearchVendorFromBaseUrl(baseUrl: string | undefined): NativeSearchVendor | undefined {
  const subscriptionVendor = SUBSCRIPTION_ORIGIN_VENDORS[baseUrl?.trim().toLowerCase().replace(/\/+$/, '') ?? ''];
  if (subscriptionVendor) return subscriptionVendor;
  const host = hostnameOf(baseUrl);
  if (!host) return undefined;
  if (host === 'api.openai.com' || host.endsWith('.api.openai.com')) return 'openai';
  if (host === 'api.anthropic.com' || host.endsWith('.api.anthropic.com')) return 'anthropic';
  if (host === 'generativelanguage.googleapis.com' || host.endsWith('.googleapis.com')) {
    return host.includes('generativelanguage') ? 'google' : undefined;
  }
  if (host === 'api.x.ai' || host.endsWith('.api.x.ai')) return 'xai';
  return undefined;
}

/**
 * Default tagging for newly pulled or added chat models: tag a model whose
 * vendor exposes hosted search and whose request protocol can express it.
 * The vendor comes from an official host or, on a self-hosted gateway, the
 * model-id family (ADR 0043, 2026-09-29). Pass-through aggregators, a
 * protocol that cannot express the vendor's search (Gemini on an OpenAI row),
 * embeddings and media models stay untagged.
 */
export function suggestDiscoveredNativeSearch(input: {
  protocol: ModelProviderConfig['protocol'];
  baseUrl?: string | undefined;
  modelId: string;
  capabilities?: readonly ModelCapability[] | undefined;
}): { adapter: NativeSearchAdapterKind; capabilities: ModelCapability[] } | undefined {
  if (isPassThroughSearchGateway(input.baseUrl)) return undefined;
  const vendor = resolveNativeSearchVendor(input);
  if (!vendor) return undefined;
  if (!modelIdLooksLikeNativeSearch(vendor, bareModelId(input.modelId))) return undefined;
  if (capabilitiesExcludeChatSearch(input.capabilities)) return undefined;
  const adapter = inferNativeSearchAdapter({
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
  });
  if (!adapter) return undefined;
  if (!isNativeSearchAdapterCompatible(input.protocol, undefined, adapter, input.baseUrl, input.modelId)) {
    return undefined;
  }
  const capabilities = new Set<ModelCapability>(input.capabilities ?? []);
  capabilities.add('chat');
  capabilities.add('native-web-search');
  return { adapter, capabilities: [...capabilities] };
}

/**
 * Endpoints never auto-tagged: aggregators whose "web search" is their own
 * plugin mechanism, and subscription origins Host cannot reach.
 */
function isPassThroughSearchGateway(baseUrl: string | undefined): boolean {
  // A subscription origin Host cannot reach (only listed ones can) is not taggable either.
  const origin = baseUrl?.trim().toLowerCase().replace(/\/+$/u, '') ?? '';
  if (origin.startsWith('oauth://')) return SUBSCRIPTION_ORIGIN_VENDORS[origin] === undefined;
  const host = hostnameOf(baseUrl);
  return host === 'openrouter.ai' || host?.endsWith('.openrouter.ai') === true;
}

/** `google/gemini-2.5-flash` → `gemini-2.5-flash`. */
function bareModelId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/^.*\//u, '');
}

export function applyDiscoveredNativeSearch(model: DiscoveredModel, input: {
  protocol: ModelProviderConfig['protocol'];
  baseUrl?: string | undefined;
}): DiscoveredModel {
  const suggestion = suggestDiscoveredNativeSearch({
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    modelId: model.id,
    capabilities: model.capabilities,
  });
  if (!suggestion) return model;
  return {
    ...model,
    capabilities: suggestion.capabilities,
    nativeSearchAdapter: model.nativeSearchAdapter ?? suggestion.adapter,
  };
}

function modelIdLooksLikeNativeSearch(vendor: NativeSearchVendor, modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id || isNonChatModelId(id)) return false;
  switch (vendor) {
    case 'openai':
      return isOpenAiHostedSearchModelId(id);
    case 'anthropic':
      return isAnthropicHostedSearchModelId(id);
    case 'google':
      return isGeminiHostedSearchModelId(id);
    case 'xai':
      return isXaiHostedSearchModelId(id);
  }
}

function isNonChatModelId(id: string): boolean {
  return /(?:^|[-_/])(?:embed(?:ding)?s?|tts|whisper|transcribe|moderation|dall-e|imagen|veo|live|realtime|audio|image|video|imagine)(?:[-_/]|$)/u.test(
    id,
  );
}

function isOpenAiSearchPreviewModelId(modelId: string | undefined): boolean {
  const id = modelId?.trim().toLowerCase() ?? '';
  return id.includes('search');
}

function isOpenAiHostedSearchModelId(id: string): boolean {
  if (id.includes('nano')) return false;
  if (isOpenAiSearchPreviewModelId(id)) return true;
  if (/^gpt-4o(?:-mini)?(?:-|$)/u.test(id)) return true;
  if (/^gpt-4\.1(?:-mini)?(?:-|$)/u.test(id)) return true;
  if (/^gpt-5/u.test(id)) return true;
  if (/^o[34](?:-mini)?(?:-|$)/u.test(id)) return true;
  return false;
}

function isAnthropicHostedSearchModelId(id: string): boolean {
  if (!id.startsWith('claude-')) return false;
  if (id.startsWith('claude-2') || id.startsWith('claude-instant')) return false;
  // Claude 3.0 (opus/sonnet/haiku without 3.5/3.7) predates hosted web_search.
  if (/^claude-3-(?:opus|sonnet|haiku)(?:-|$)/u.test(id) && !id.includes('3.5') && !id.includes('3.7')) {
    return false;
  }
  return true;
}

function isGeminiHostedSearchModelId(id: string): boolean {
  if (!id.startsWith('gemini-')) return false;
  if (id.startsWith('gemini-1')) return false;
  if (id.includes('gemma') || id.includes('aqa') || id.includes('learnlm')) return false;
  return true;
}

function isXaiHostedSearchModelId(id: string): boolean {
  const match = /^grok-(\d+)/u.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= 4;
}

function capabilitiesExcludeChatSearch(capabilities: readonly ModelCapability[] | undefined): boolean {
  if (!capabilities || capabilities.length === 0) return false;
  const hasChat = capabilities.includes('chat') || capabilities.includes('native-web-search');
  if (hasChat) return false;
  return capabilities.every((capability) =>
    capability === 'image-generation' ||
    capability === 'video-generation' ||
    capability === 'speech-to-text' ||
    capability === 'text-to-speech' ||
    capability === 'realtime-audio',
  );
}

function hostnameOf(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
