import type { WebSearchSource, WebSearchTestResult } from '@piwin/contracts';
import { webSearch } from './search-provider.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';

/**
 * Run a deliberately small connectivity check for a credential-backed source.
 * The fixed query keeps the UI check predictable and limits provider usage.
 */
export async function testSearchSource(
  source: WebSearchSource,
  credentials: WebRuntimeCredentials = {},
): Promise<WebSearchTestResult> {
  if (source.kind !== 'brave' && source.kind !== 'tavily') {
    throw new Error(`Search source "${source.id}" does not support connectivity tests`);
  }

  const startedAt = Date.now();
  const result = await webSearch(
    'piwin',
    {
      searchProvider: source.kind,
      searchApiKeyEnv: source.apiKeyEnv ?? '',
      searchMaxResults: 1,
      searchTimeoutMs: 12_000,
      searchSources: [{ ...source, enabled: true }],
      searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 8_000 },
    },
    undefined,
    credentials,
  );

  return {
    sourceId: source.id,
    kind: source.kind,
    durationMs: Date.now() - startedAt,
    resultCount: result.hits.length,
  };
}
