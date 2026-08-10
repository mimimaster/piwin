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
  resolveNativeWebSearchMode,
} from '@piwin/contracts';

/** Adapter-reported native-search support for the active host mode. */
export type NativeSearchAdapterSupport = {
  /**
   * Whether the adapter can inject/disable provider-native search on the
   * request (streamSimple / onPayload wrapper). Required for readiness.
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
  model?: Pick<
    ModelConfigEntry,
    'id' | 'enabled' | 'capabilities' | 'nativeWebSearchMode' | 'routes'
  > | null;
  /** External multi-source web config (Host `web_search`). */
  web?: Pick<WebConfig, 'searchSources' | 'searchRoutePolicy'> | null | undefined;
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
  let incompatible = false;

  // Always-on native search cannot honor external-only exclusivity.
  if (policy === 'external-only' && readiness.native.alwaysOn) {
    incompatible = true;
    issues.push(
      'external-only is incompatible with an always-on native-web-search model; native search cannot be disabled',
    );
  }

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
      // Always-on native still forces native when exclusivity cannot be claimed.
      if (readiness.native.alwaysOn && nativeReady) {
        selected = 'native';
        fallback = null;
      } else {
        selected = externalReady ? 'external' : null;
        fallback = null;
        if (!externalReady) {
          issues.push(
            'external-only policy selected but no enabled external search source is ready',
          );
        }
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
    incompatible,
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

  const alwaysOn = modelTagged && model ? resolveNativeWebSearchMode(model) === 'always-on' : false;

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
    alwaysOn,
    reasons,
  };
}

function evaluateExternalReadiness(input: ResolveSearchRouteInput): SearchBackendReadiness {
  const reasons: string[] = [];
  const sources = input.web?.searchSources ?? [];
  const hasEnabledSources = sources.some((source) => source.enabled);
  if (!input.web) {
    reasons.push('web tools config is absent');
  } else if (!hasEnabledSources) {
    reasons.push('no enabled external search source');
  }
  return {
    ready: Boolean(input.web && hasEnabledSources),
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

/**
 * Build the default adapter support declaration for the current product.
 * Request shaping is supported via streamSimple wrappers; citation
 * normalization is best-effort and provider-specific.
 */
export function defaultNativeSearchAdapterSupport(): NativeSearchAdapterSupport {
  return {
    requestSupported: true,
    citationSupported: true,
  };
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

/**
 * Short capability brief describing the selected search route for the agent.
 * Prompt text is informational only; the compiled route is authoritative.
 */
export function formatSearchRouteCapabilityBrief(route: ResolvedSearchRoute): string | undefined {
  if (route.selected === 'native') {
    return [
      'Search routing: provider-native web search is enabled for this generation.',
      'The Host web_search tool is not registered. Do not attempt external web_search.',
      route.readiness.native.adapterCitationSupported
        ? 'Native citations are normalized into product evidence when the provider returns them.'
        : 'Native citation normalization may be incomplete for this provider.',
    ].join(' ');
  }
  if (route.selected === 'external') {
    return [
      'Search routing: external Host web_search is enabled for this generation.',
      'Provider-native web search is disabled when controllable.',
      'Use the web_search tool for web lookup.',
    ].join(' ');
  }
  return [
    'Search routing: no web search backend is available for this generation.',
    route.issues[0] ?? 'Configure an external search source or a native-web-search model.',
  ].join(' ');
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
