/**
 * Pure search-route resolver (ADR 0043).
 *
 * Host `web_search` is the only search outlet. The route is an ordered chain
 * tried inside one tool call: native sub-request, configured sources, then
 * the free DuckDuckGo floor. Never a silent whole-prompt replay.
 */

import type {
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRef,
  NativeSearchAdapterKind,
  PiwinConfig,
  ProviderChatApi,
  ResolvedSearchRoute,
  SearchBackendReadiness,
  SearchRoutePolicy,
  SearchRouteReadiness,
  WebConfig,
} from '@piwin/contracts';
import {
  buildSearchChain,
  inferSearchRoutePolicy,
  isModelEnabled,
  isProviderEnabled,
  nativeSearchProviderBlocker,
  nativeSearchProtocolSwitch,
  resolveModelEndpoint,
  modelSupportsCapability,
  resolveNativeSearchAdapter,
} from '@piwin/contracts';

/** Adapter-reported native-search support for the active host mode. */
export type NativeSearchAdapterSupport = {
  /**
   * Whether a declared or inferred adapter can shape provider-native search
   * fields on the Host `web_search` sub-request.
   */
  requestSupported: boolean;
  /** Resolved adapter when request shaping is available. */
  adapter?: NativeSearchAdapterKind;
  /** Stable user-facing explanation when request shaping is unavailable. */
  reason?: string;
};

export type ResolveSearchRouteInput = {
  policy?: SearchRoutePolicy;
  /** Selected chat model for this generation, when known. */
  model?: Pick<ModelConfigEntry, 'id' | 'enabled' | 'capabilities' | 'nativeSearchAdapter'> | null;
  /** Provider of `model`, used to infer an adapter when the model omits one. */
  provider?: Pick<ModelProviderConfig, 'protocol' | 'chatApi' | 'baseUrl'> | null;
  /** External Host `web_search` config (ordinary sources or model delegate). */
  web?:
    | (Pick<WebConfig, 'searchSources'> &
        Partial<Pick<WebConfig, 'searchRoutePolicy' | 'searchDelegateModel'>>)
    | null
    | undefined;
  /** Host validation result for the configured native `web_search` delegate model. */
  delegateReady?: boolean;
  adapter: NativeSearchAdapterSupport;
};

/**
 * Resolve the ordered `web_search` chain for one generation.
 */
export function resolveSearchRoute(input: ResolveSearchRouteInput): ResolvedSearchRoute {
  const policy = inferSearchRoutePolicy(
    input.policy ?? input.web?.searchRoutePolicy,
    input.web?.searchSources ?? [],
  );
  const readiness = evaluateSearchReadiness(input);
  const issues: string[] = [...readiness.native.reasons, ...readiness.external.reasons];
  const sources = input.web?.searchSources ?? [];
  const hasEnabledSources = sources.some((source) => source.enabled);
  const duckduckgoEnabled = sources.some((source) => source.kind === 'duckduckgo' && source.enabled);
  const nativeReady = readiness.native.ready;
  const chain = input.web
    ? buildSearchChain({
        policy,
        nativeReady,
        hasEnabledSources,
        duckduckgoEnabled,
      })
    : [];

  if (policy === 'native-only' && !nativeReady) {
    issues.push('native-only policy selected but native web search is not ready');
  }
  if (chain.length === 0) {
    issues.push('no search backend is ready for the configured policy');
  }

  return {
    policy,
    chain,
    readiness,
    issues: dedupeIssues(issues),
  };
}

/**
 * Resolve one generation's `web_search` chain from live config: the chat
 * model (or the configured default), its native-search adapter support, and
 * the configured delegate. Every compile / tool-build path goes through here
 * so Settings, blueprint and the executed tool agree.
 */
export function resolveGenerationSearchRoute(input: {
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>;
  model?: ModelRef | null | undefined;
  /** Live or draft Web config; its `searchDelegateModel` is the delegate checked. */
  web: ResolveSearchRouteInput['web'];
  policy?: SearchRoutePolicy;
}): ResolvedSearchRoute {
  const configured = findConfiguredModel(input.config, input.model);
  return resolveSearchRoute({
    model: configured?.model ?? null,
    ...(configured?.provider ? { provider: configured.provider } : {}),
    web: input.web,
    adapter: resolveConfiguredNativeSearchSupport(configured),
    delegateReady: Boolean(
      findReadyWebSearchDelegate(input.config, input.web?.searchDelegateModel ?? undefined),
    ),
    ...(input.policy ? { policy: input.policy } : {}),
  });
}

/** Evaluate native + external readiness without selecting a route. */
export function evaluateSearchReadiness(input: ResolveSearchRouteInput): SearchRouteReadiness {
  return {
    native: evaluateNativeReadiness(input),
    external: evaluateExternalReadiness(input),
  };
}

function evaluateNativeReadiness(input: ResolveSearchRouteInput): SearchBackendReadiness {
  const reasons: string[] = [];
  const model = input.model;
  const modelTagged =
    model !== undefined &&
    model !== null &&
    isModelEnabled(model) &&
    modelSupportsCapability(model, 'native-web-search');

  const adapterRequestSupported = input.adapter.requestSupported;
  if (modelTagged && !adapterRequestSupported) {
    reasons.push(
      input.adapter.reason ??
        'active Pi adapter cannot express provider-native web search for this model',
    );
  }

  const delegateConfigured = input.web?.searchDelegateModel !== undefined;
  const hasDelegateModel = delegateConfigured && input.delegateReady === true;
  if (delegateConfigured && !hasDelegateModel) {
    reasons.push('configured web_search delegate model is unavailable');
  }
  // A configured delegate is the exclusive native executor (stale → not
  // ready, never silently the chat model); otherwise the chat model itself
  // needs the tag + an expressible adapter. Untagged chat models are not an
  // issue: native simply does not exist for that generation.
  const chatModelReady = Boolean(modelTagged && adapterRequestSupported);
  const ready = delegateConfigured ? hasDelegateModel : chatModelReady;

  return {
    ready,
    modelTagged: Boolean(modelTagged),
    adapterRequestSupported,
    hasDelegateModel,
    reasons: hasDelegateModel ? reasons.filter(isDelegateIssue) : reasons,
  };
}

function isDelegateIssue(reason: string): boolean {
  return reason.includes('delegate');
}

function evaluateExternalReadiness(input: ResolveSearchRouteInput): SearchBackendReadiness {
  const reasons: string[] = [];
  const sources = input.web?.searchSources ?? [];
  const hasEnabledSources = sources.some((source) => source.enabled);
  if (!input.web) {
    reasons.push('web tools config is absent');
  }
  return {
    // DuckDuckGo floor keeps sources runnable whenever web config exists,
    // even with every user source off (except native-only, which omits the floor).
    ready: Boolean(input.web),
    hasEnabledSources,
    reasons,
  };
}

/**
 * Resolve the configured model entry for a ModelRef against live providers.
 */
export function findConfiguredModel(
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>,
  modelRef?: ModelRef | null,
): { provider: ModelProviderConfig; model: ModelConfigEntry } | undefined {
  const providers = (config.providers ?? []).filter(isProviderEnabled);
  if (modelRef) {
    const provider = providers.find((entry) => entry.id === modelRef.providerId);
    const model = provider?.models.find((entry) => entry.id === modelRef.modelId);
    if (provider && model) {
      return { provider, model };
    }
    return undefined;
  }
  const defaultProviderId = config.defaultProviderId;
  const defaultModelId = config.defaultModelId;
  if (defaultProviderId && defaultModelId) {
    const provider = providers.find((entry) => entry.id === defaultProviderId);
    const model = provider?.models.find((entry) => entry.id === defaultModelId);
    if (provider && model) {
      return { provider, model };
    }
  }
  for (const provider of providers) {
    const model = provider.models.find(
      (entry) => isModelEnabled(entry) && modelSupportsCapability(entry, 'chat'),
    );
    if (model) {
      return { provider, model };
    }
  }
  return undefined;
}

/** Resolve a valid configured model that may exclusively back Host `web_search`. */
export function findReadyWebSearchDelegate(
  config: Pick<PiwinConfig, 'providers'> & { web?: Pick<WebConfig, 'searchDelegateModel'> },
  modelRef: ModelRef | undefined = config.web?.searchDelegateModel,
): { provider: ModelProviderConfig; model: ModelConfigEntry; ref: ModelRef } | undefined {
  if (!modelRef) {
    return undefined;
  }
  const configured = findConfiguredModel(config, modelRef);
  if (
    !configured ||
    configured.provider.protocol !== modelRef.protocol ||
    !isModelEnabled(configured.model) ||
    !modelSupportsCapability(configured.model, 'native-web-search') ||
    !resolveConfiguredNativeSearchSupport(configured).requestSupported
  ) {
    return undefined;
  }
  return {
    ...configured,
    ref: {
      protocol: configured.provider.protocol,
      providerId: configured.provider.id,
      modelId: configured.model.id,
    },
  };
}

/**
 * Native-search support for one configured provider/model: the adapter must
 * be expressible, and a subscription provider must expose a Host-reachable
 * HTTPS surface (`oauth://` is a Pi-only marker the executor cannot POST to).
 */
export function resolveConfiguredNativeSearchSupport(
  configured: { provider: ModelProviderConfig; model: ModelConfigEntry } | undefined,
): NativeSearchAdapterSupport {
  if (!configured) {
    return resolveNativeSearchAdapterSupport(undefined);
  }
  const { model } = configured;
  // ADR 0079: judge the model's own wire format, not its provider row's.
  const provider = resolveModelEndpoint(configured.provider, model);
  const blocker = nativeSearchProviderBlocker(provider);
  if (blocker) {
    return { requestSupported: false, reason: blocker };
  }
  return resolveNativeSearchAdapterSupport(
    provider.protocol,
    model.nativeSearchAdapter,
    provider.chatApi,
    provider.baseUrl,
    model.id,
  );
}

/**
 * Resolve native-search support for a model. An explicit adapter wins when it
 * is compatible with the provider protocol; otherwise Host infers from
 * protocol / official vendor host / model id.
 */
export function resolveNativeSearchAdapterSupport(
  protocol: ModelProviderConfig['protocol'] | undefined,
  nativeSearchAdapter?: NativeSearchAdapterKind,
  chatApi?: ProviderChatApi,
  baseUrl?: string,
  modelId?: string,
): NativeSearchAdapterSupport {
  if (protocol === undefined) {
    return {
      requestSupported: false,
      reason: 'native web search provider protocol is unavailable',
    };
  }
  const adapter = resolveNativeSearchAdapter({
    protocol,
    chatApi,
    baseUrl,
    modelId,
    nativeSearchAdapter,
  });
  if (!adapter) {
    const needed = nativeSearchProtocolSwitch({ protocol, baseUrl, modelId });
    return {
      requestSupported: false,
      reason: needed
        ? `native web search for ${modelId ?? 'this model'} needs the ${needed} request protocol`
        : nativeSearchAdapter
          ? `nativeSearchAdapter ${nativeSearchAdapter} is incompatible with ${protocol}`
          : 'nativeSearchAdapter is required for models tagged native-web-search',
    };
  }
  return { requestSupported: true, adapter };
}

/**
 * @deprecated Use {@link resolveNativeSearchAdapterSupport}; kept for call-site
 * compatibility while protocol/chatApi remain the public inputs.
 */
export function isAdapterExpressibleForProtocol(
  protocol: ModelProviderConfig['protocol'] | undefined,
  chatApi: ProviderChatApi | undefined,
  nativeSearchAdapter: NativeSearchAdapterKind,
): boolean {
  return resolveNativeSearchAdapter({
    protocol,
    chatApi,
    nativeSearchAdapter,
  }) === nativeSearchAdapter;
}

/** Whether Host `web_search` is registered for this generation. */
export function shouldExposeExternalWebSearch(route: ResolvedSearchRoute): boolean {
  return route.chain.length > 0;
}

/** Whether Host `web_search` includes a provider-native sub-request. */
export function shouldEnableNativeWebSearch(route: ResolvedSearchRoute): boolean {
  return route.chain.includes('native');
}

function dedupeIssues(issues: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const issue of issues) {
    const trimmed = issue.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
