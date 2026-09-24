/**
 * Config a fresh subscription sign-in sets up on its own.
 *
 * Signing into Devin is, for most people, the point of having free code_search
 * and a free web-search source: both reuse `oauth:devin`. So a Devin login
 * fills those in — but only where the user has not made a choice of their own.
 * A configured code_search model or pasted token stays; a Devin source the user
 * once added and switched off stays off. The search priority is never changed
 * here: someone on "model-native first" may have picked it on purpose, so the
 * client is told and offers the switch instead.
 */
import {
  createDefaultCodeSearchConfig,
  createDefaultWebConfig,
  type CodeSearchConfig,
  type PiwinConfig,
  type SubscriptionLoginFollowUp,
  type WebSearchSource,
} from '@piwin/contracts';

const DEVIN_PROVIDER_ID = 'devin';
const DEVIN_ACCOUNT_REF = 'oauth:devin';

export type SubscriptionLoginDefaults = {
  config: PiwinConfig;
  followUp?: SubscriptionLoginFollowUp;
};

/** The user already chose how code_search runs: a model, or a pasted token. */
function hasOwnCodeSearchChoice(codeSearch: CodeSearchConfig): boolean {
  if (codeSearch.backend !== 'windsurf' && codeSearch.model !== undefined) return true;
  const ref = codeSearch.apiKeyRef?.trim();
  if (ref && ref !== DEVIN_ACCOUNT_REF) return true;
  return Boolean(codeSearch.apiKeyEnv?.trim());
}

function withDevinCodeSearch(codeSearch: CodeSearchConfig): CodeSearchConfig | undefined {
  if (hasOwnCodeSearchChoice(codeSearch)) return undefined;
  // An enabled model backend without an explicit model already works (it uses
  // the default chat model); only a disabled or credential-less windsurf setup
  // is missing something the Devin account provides.
  if (codeSearch.enabled && codeSearch.backend !== 'windsurf') return undefined;
  if (codeSearch.enabled && codeSearch.apiKeyRef?.trim() === DEVIN_ACCOUNT_REF) return undefined;
  const next: CodeSearchConfig = {
    ...codeSearch,
    enabled: true,
    backend: 'windsurf',
    apiKeyRef: DEVIN_ACCOUNT_REF,
  };
  delete next.apiKeyEnv;
  return next;
}

function uniqueSourceId(sources: readonly WebSearchSource[]): string {
  const taken = new Set(sources.map((source) => source.id));
  if (!taken.has(DEVIN_PROVIDER_ID)) return DEVIN_PROVIDER_ID;
  let index = 2;
  while (taken.has(`${DEVIN_PROVIDER_ID}-${index}`)) index += 1;
  return `${DEVIN_PROVIDER_ID}-${index}`;
}

export function applySubscriptionLoginDefaults(
  config: PiwinConfig,
  providerId: string,
): SubscriptionLoginDefaults {
  if (providerId !== DEVIN_PROVIDER_ID) return { config };

  const enabled: SubscriptionLoginFollowUp['enabled'] = [];
  let next = config;

  const codeSearch = withDevinCodeSearch(config.codeSearch ?? createDefaultCodeSearchConfig());
  if (codeSearch) {
    next = { ...next, codeSearch };
    enabled.push('code-search');
  }

  const web = next.web ?? createDefaultWebConfig();
  if (!web.searchSources.some((source) => source.kind === 'devin')) {
    const source: WebSearchSource = {
      id: uniqueSourceId(web.searchSources),
      kind: 'devin',
      enabled: true,
      apiKeyRef: DEVIN_ACCOUNT_REF,
    };
    next = { ...next, web: { ...web, searchSources: [...web.searchSources, source] } };
    enabled.push('web-search-source');
  }

  const devinSearchOn = (next.web ?? web).searchSources.some(
    (source) => source.kind === 'devin' && source.enabled,
  );
  const policy = (next.web ?? web).searchRoutePolicy;
  const suggestExternalSearchPriority =
    devinSearchOn && (policy === 'native-first' || policy === 'native-only');

  if (enabled.length === 0 && !suggestExternalSearchPriority) return { config };
  return {
    config: next,
    followUp: {
      enabled,
      ...(suggestExternalSearchPriority ? { suggestExternalSearchPriority: true } : {}),
    },
  };
}
