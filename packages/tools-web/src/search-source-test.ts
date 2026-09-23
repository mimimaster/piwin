import type {
  WebSearchSource,
  WebSearchTestResult,
  WebSearchTestableSourceKind,
} from '@piwin/contracts';
import { webSearch } from './search-provider.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';

const TESTABLE_KINDS = new Set<WebSearchTestableSourceKind>([
  'brave',
  'tavily',
  'searxng',
  'cli',
  'http',
  'devin',
]);

function isTestableKind(kind: WebSearchSource['kind']): kind is WebSearchTestableSourceKind {
  return TESTABLE_KINDS.has(kind as WebSearchTestableSourceKind);
}

/**
 * Run a deliberately small connectivity check for a Settings search source.
 * The fixed query keeps the UI check predictable and limits provider usage.
 */
export async function testSearchSource(
  source: WebSearchSource,
  credentials: WebRuntimeCredentials = {},
): Promise<WebSearchTestResult> {
  if (!isTestableKind(source.kind)) {
    throw new Error(`Search source "${source.id}" does not support connectivity tests`);
  }
  if (source.kind === 'cli') {
    if (!source.command?.trim()) {
      throw new Error(`CLI search source "${source.id}" is missing command`);
    }
    const haystack = [source.command, ...(source.args ?? ['{{query}}'])];
    if (!haystack.some((part) => part.includes('{{query}}'))) {
      throw new Error(`CLI search source "${source.id}" args must include {{query}}`);
    }
  }
  if ((source.kind === 'searxng' || source.kind === 'http') && !source.baseUrl?.trim()) {
    throw new Error(
      `${source.kind === 'http' ? 'HTTP' : 'SearXNG'} search source "${source.id}" is missing URL`,
    );
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
