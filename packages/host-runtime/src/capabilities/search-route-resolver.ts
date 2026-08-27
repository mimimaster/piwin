/**
 * Pure search-route resolver (ADR 0043).
 *
 * Chooses exactly one search backend for a generation from the product policy,
 * model native-search readiness, adapter support, and external source config.
 * Does not silently retry a completed/failed prompt on the other backend.
 */

import type {
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRef,
  NativeSearchAdapterKind,
  PiwinConfig,
  ResolvedSearchRoute,
  SearchBackend,
  SearchBackendReadiness,
  SearchRoutePolicy,
  SearchRouteReadiness,
  WebConfig,
} from '@piwin/contracts';
import {
  DEFAULT_SEARCH_ROUTE_POLICY,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
} from '@piwin/contracts';

/** Adapter-reported native-search support for the active host mode. */
export type NativeSearchAdapterSupport = {
  /**
   * Whether the adapter can shape provider-native search fields on the request
   * (streamSimple / onPayload wrapper). Required for readiness.
   */
  requestSupported: boolean;
  /**
   * Whether native citation/grounding metadata can be normalized. Optional for
   * enabling the request, but required for "full" readiness in Settings.
   */
  citationSupported: boolean;
};

export type ResolveSearchRouteInput = {
  policy?: SearchRoutePolicy;
  /** Selected chat model for this generation, when known. */
  model?: Pick<ModelConfigEntry, 'id' | 'enabled' | 'capabilities'> | null;
  /** External Host `web_search` config (ordinary sources or model delegate). */
  web?:
    | Pick<WebConfig, 'searchSources' | 'searchRoutePolicy' | 'searchDelegateModel'>
    | null
    | undefined;
  /** Host validation result for the configured `web_search` delegate model. */
  externalDelegateReady?: boolean;
  adapter: NativeSearchAdapterSupport;
};

/**
 * Resolve the single search outlet for one generation.
 * Fallback is capability availability before the request starts only.
 */
export function resolveSearchRoute(input: ResolveSearchRouteInput): ResolvedSearchRoute {
  const policy = input.policy ?? input.web?.searchRoutePolicy ?? DEFAULT_SEARCH_ROUTE_POLICY;
  const readiness = evaluateSearchReadiness(input);
  const issues: string[] = [...readiness.native.reasons, ...readiness.external.reasons];

  const nativeReady = readiness.native.ready;
  const externalReady = readiness.external.ready;

  let selected: SearchBackend | null = null;
  let fallback: SearchBackend | null = null;

  switch (policy) {
    case 'native-first': {
      if (nativeReady) {
        selected = 'native';
        fallback = externalReady ? 'external' : null;
      } else if (externalReady) {
        selected = 'external';
        fallback = null;
      }
      break;
    }
    case 'external-first': {
      if (externalReady) {
        selected = 'external';
        fallback = nativeReady ? 'native' : null;
      } else if (nativeReady) {
        selected = 'native';
        fallback = null;
      }
      break;
    }
    case 'native-only': {
      selected = nativeReady ? 'native' : null;
      fallback = null;
      if (!nativeReady) {
        issues.push('native-only policy selected but native web search is not ready');
      }
      break;
    }
    case 'external-only': {
      selected = externalReady ? 'external' : null;
      fallback = null;
      if (!externalReady) {
        issues.push('external-only policy selected but no external web_search backend is ready');
      }
      break;
    }
  }

  if (selected === null) {
    issues.push('no search backend is ready for the configured policy');
  }

  return {
    policy,
    selected,
    fallback,
    readiness,
    issues: dedupeIssues(issues),
  };
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

  if (!model) {
    reasons.push('no chat model selected for native web search');
  } else if (!isModelEnabled(model)) {
    reasons.push('selected chat model is disabled');
  } else if (!modelSupportsCapability(model, 'native-web-search')) {
    reasons.push('selected chat model is not tagged native-web-search');
  }

  const adapterRequestSupported = input.adapter.requestSupported;
  if (modelTagged && !adapterRequestSupported) {
    reasons.push('active Pi adapter cannot express provider-native web search for this model');
  }

  const adapterCitationSupported = input.adapter.citationSupported;
  if (modelTagged && adapterRequestSupported && !adapterCitationSupported) {
    reasons.push(
      'native web search request shaping is available, but citation normalization is not fully supported',
    );
  }

  // Request enablement requires tag + adapter request support. Citation is not
  // required to select the native outlet (ADR: lack of citation must not be
  // reported as full readiness in UI, but request enablement still works).
  const ready = Boolean(modelTagged && adapterRequestSupported);

  return {
    ready,
    modelTagged: Boolean(modelTagged),
    adapterRequestSupported,
    adapterCitationSupported,
    reasons,
  };
}

function evaluateExternalReadiness(input: ResolveSearchRouteInput): SearchBackendReadiness {
  const reasons: string[] = [];
  const sources = input.web?.searchSources ?? [];
  const hasEnabledSources = sources.some((source) => source.enabled);
  const delegateConfigured = input.web?.searchDelegateModel !== undefined;
  const hasDelegateModel = delegateConfigured && input.externalDelegateReady === true;
  if (!input.web) {
    reasons.push('web tools config is absent');
  } else if (delegateConfigured && !hasDelegateModel) {
    reasons.push('configured web_search delegate model is unavailable');
  } else if (!delegateConfigured && !hasEnabledSources) {
    reasons.push('no enabled external search source');
  }
  return {
    ready: Boolean(input.web && (delegateConfigured ? hasDelegateModel : hasEnabledSources)),
    hasEnabledSources,
    hasDelegateModel,
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
    !resolveNativeSearchAdapterSupport(
      configured.provider.protocol,
      configured.model.nativeSearchAdapter,
    ).requestSupported
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
 * Resolve native-search support for a model. The model's declared request
 * shaping (nativeSearchAdapter) must actually be expressible for its
 * provider protocol; a protocol match alone is not evidence that a vendor
 * gateway accepts the generic native-search fields.
 */
export function resolveNativeSearchAdapterSupport(
  protocol: ModelProviderConfig['protocol'] | undefined,
  nativeSearchAdapter?: NativeSearchAdapterKind,
): NativeSearchAdapterSupport {
  return {
    // Legacy configs omit the declaration; fall back to the protocol's
    // canonical shaping so existing setups keep working. Declared kinds are
    // checked strictly (vendor-specific shapes are never generically safe).
    requestSupported:
      nativeSearchAdapter === undefined
        ? protocol === 'openai-compatible' ||
          protocol === 'anthropic-compatible' ||
          protocol === 'google-gemini'
        : isAdapterExpressibleForProtocol(protocol, nativeSearchAdapter),
    // Pi 0.80.10 does not preserve provider annotations/grounding metadata in
    // its normalized AssistantMessage events. Keep this false until the
    // adapter receives those response fields; request shaping still works.
    citationSupported: false,
  };
}

/**
 * Whether the request-shaping layer can express a declared native-search
 * mechanism for a provider protocol.
 */
export function isAdapterExpressibleForProtocol(
  protocol: ModelProviderConfig['protocol'] | undefined,
  nativeSearchAdapter: NativeSearchAdapterKind,
): boolean {
  switch (nativeSearchAdapter) {
    case 'openai-web-search-options':
    case 'openai-responses-tool':
      return protocol === 'openai-compatible';
    case 'anthropic-web-search-tool':
      return protocol === 'anthropic-compatible';
    case 'google-search-tool':
      return protocol === 'google-gemini';
    case 'vendor-specific':
      // Custom header/extra_body/tool shapes need a dedicated adapter; never
      // guess them from the transport protocol.
      return false;
  }
}

/**
 * Whether the Host external `web_search` tool should be registered for this
 * resolved route.
 */
export function shouldExposeExternalWebSearch(route: ResolvedSearchRoute): boolean {
  return route.selected === 'external';
}

/**
 * Whether provider-native search should be enabled on the model request.
 */
export function shouldEnableNativeWebSearch(route: ResolvedSearchRoute): boolean {
  return route.selected === 'native';
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
