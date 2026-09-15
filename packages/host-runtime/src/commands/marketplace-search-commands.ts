/** Host IPC: search and install npm/GitHub Pi packages. */
import type { HostCommand, HostResponse, MarketplaceSearchResult } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { installPiPackage } from '@piwin/agent-host';
import {
  isNpmPackageName,
  normalizeRepositoryUrl,
  searchMarketplaceSources,
} from '@piwin/marketplace';
import { fail, ok } from '../response-helpers.js';
import { getPiAgentDir, getPiwinRoot } from '../paths.js';

const TYPES = new Set<HostCommand['type']>([
  'marketplace/search',
  'marketplace/package-install',
]);
const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export type MarketplaceSearchCommandDeps = {
  fetch?: typeof fetch;
  piwinRoot?: string;
  agentDir?: string;
  installPackage?: typeof installPiPackage;
};

function resolvePiPackageSource(
  source: Extract<HostCommand, { type: 'marketplace/package-install' }>['source'],
): string {
  if (source.kind === 'npm') {
    const packageName = source.packageName.trim();
    if (!isNpmPackageName(packageName)) {
      throw new Error('Invalid npm package name');
    }
    return `npm:${packageName}`;
  }

  const normalized = normalizeRepositoryUrl(source.repositoryUrl);
  if (!normalized) {
    throw new Error('Invalid GitHub repository URL');
  }
  const repository = new URL(normalized);
  const segments = repository.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (
    repository.protocol !== 'https:' ||
    repository.hostname.toLowerCase() !== 'github.com' ||
    segments.length !== 2 ||
    !segments[0] ||
    !segments[1] ||
    !GITHUB_SEGMENT.test(segments[0]) ||
    !GITHUB_SEGMENT.test(segments[1]) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Only https://github.com/<owner>/<repository> package URLs are supported');
  }
  return `git:github.com/${segments[0]}/${segments[1]}`;
}

export async function handleMarketplaceSearchCommand(
  command: HostCommand,
  requestId: string | undefined,
  deps: MarketplaceSearchCommandDeps = {},
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  if (command.type === 'marketplace/package-install') {
    try {
      const source = resolvePiPackageSource(command.source);
      const result = await (deps.installPackage ?? installPiPackage)({
        source,
        workingDirectory: getPiwinRoot(deps.piwinRoot),
        agentDirectory: deps.agentDir ?? getPiAgentDir(),
      });
      return ok(requestId, 'marketplace/package-install', { source: result.source });
    } catch (error) {
      return fail(requestId, 'marketplace/package-install', formatError(error));
    }
  }
  if (command.type !== 'marketplace/search') {
    return null;
  }
  const query = command.query.trim();
  if (!query) {
    const empty: MarketplaceSearchResult = { query: '', hits: [] };
    return ok(requestId, 'marketplace/search', empty);
  }
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const result = await searchMarketplaceSources({
      query,
      ...(command.limit !== undefined ? { limit: command.limit } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(githubToken ? { githubToken } : {}),
    });
    return ok(requestId, 'marketplace/search', result);
  } catch (error) {
    const result: MarketplaceSearchResult = {
      query,
      hits: [],
      remoteError: formatError(error),
    };
    return ok(requestId, 'marketplace/search', result);
  }
}
