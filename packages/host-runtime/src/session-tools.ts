import type {
  HostToolRegistration,
  WebConfig,
  WebDocumentExtractor,
  WebFetchExtractDelegate,
  WebFetchSpillStore,
  WebPageRenderer,
} from '@piwin/contracts';
import { createWebToolDefinitions } from '@piwin/tools-web';
import type {
  FetchCache,
  FetchHostResolver,
  WebRuntimeCredentials,
  WebSearchModelDelegate,
} from '@piwin/tools-web';

export type SessionToolRegistration = {
  tools: HostToolRegistration[];
};

export type BuildSessionToolsOptions = {
  webConfig?: WebConfig;
  /** Host-resolved secrets kept in memory and never written into WebConfig. */
  webCredentials?: WebRuntimeCredentials;
  /** Optional configured model that exclusively backs Host `web_search`. */
  webSearchDelegate?: WebSearchModelDelegate;
  /** Host-scoped extracted-page cache. Hits skip the network, not permission. */
  fetchCache?: FetchCache;
  /** Optional configured model that extracts a query-focused `web_fetch` excerpt. */
  webFetchExtractDelegate?: WebFetchExtractDelegate;
  /** Optional one-shot HTML renderer for `fetchFallback: 'browser'`. */
  pageRenderer?: WebPageRenderer;
  /** Test / Host-injected DNS resolver for fetch SSRF checks. */
  resolveHostAddresses?: FetchHostResolver;
  /** Host-injected PDF / document extract. */
  documentExtractor?: WebDocumentExtractor;
  /** Host-injected full-text spill for grep / read_file. */
  spillStore?: WebFetchSpillStore;
};

function isBuildOptions(value: unknown): value is BuildSessionToolsOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return (
    'webConfig' in value ||
    'webCredentials' in value ||
    'webSearchDelegate' in value ||
    'fetchCache' in value ||
    'webFetchExtractDelegate' in value ||
    'pageRenderer' in value ||
    'resolveHostAddresses' in value ||
    'documentExtractor' in value ||
    'spillStore' in value
  );
}

/**
 * Build host-owned tools to attach to a Pi session.
 * Web executors are returned as registrations; the Host router admits them
 * before any network operation starts.
 */
export function buildSessionTools(
  options: BuildSessionToolsOptions | WebConfig = {},
): SessionToolRegistration {
  if (isBuildOptions(options)) {
    return {
      tools: createWebToolDefinitions(
        options.webConfig,
        options.webCredentials,
        options.webSearchDelegate,
        options.fetchCache,
        options.webFetchExtractDelegate,
        options.pageRenderer,
        options.resolveHostAddresses,
        options.documentExtractor,
        options.spillStore,
      ),
    };
  }
  return { tools: createWebToolDefinitions(options as WebConfig) };
}
