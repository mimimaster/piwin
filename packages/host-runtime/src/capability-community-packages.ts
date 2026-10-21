/**
 * Community Pi packages (npm `pi-package` keyword, GitHub `topic:pi-package`)
 * for the agent's capability tools. Ids are the live-search ids (`npm:<name>`,
 * `github:<owner>/<repo>`) and install through the same validated source
 * resolver as Desktop's "install package".
 */
import type { MarketplacePiPackageSource, MarketplaceSearchHit, ToolResult } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { EXCLUDED_COMMUNITY_RECOMMENDATIONS } from '@piwin/marketplace';
import { resolvePiPackageSource } from './marketplace/pi-package-source.js';

/** Enough to pick from without flooding the transcript. */
export const COMMUNITY_PACKAGE_SEARCH_LIMIT = 8;
const PI_RUNTIME_BOUNDARY =
  'piwin runs Agent Runtime extensions (tools, hooks, confirm/select/input); Pi TUI plugins (custom UI, themes, keybindings) do not work.';

export type CommunityPackagePorts = {
  searchCommunityPackages: (input: {
    query: string;
    limit: number;
    signal: AbortSignal;
  }) => Promise<MarketplaceSearchHit[]>;
  installPiPackage: (input: {
    source: string;
    workingDirectory: string;
    agentDirectory: string;
  }) => Promise<unknown>;
};

function describeHit(hit: MarketplaceSearchHit): Record<string, unknown> {
  return {
    entryId: hit.entryId,
    kind: 'extension',
    name: hit.name,
    summary: hit.description,
    curated: false,
    source:
      hit.source === 'github'
        ? 'GitHub topic:pi-package (not reviewed by piwin)'
        : 'npm pi-package (not reviewed by piwin)',
    ...(hit.version && hit.version !== 'latest' ? { version: hit.version } : {}),
    ...(hit.monthlyDownloads !== undefined ? { monthlyDownloads: hit.monthlyDownloads } : {}),
    ...(hit.stars !== undefined ? { stars: hit.stars } : {}),
    note: `Installing may run npm install scripts with the Host user's permissions. ${PI_RUNTIME_BOUNDARY}`,
  };
}

export async function searchCommunityPackageEntries(
  ports: CommunityPackagePorts,
  input: { query: string; signal: AbortSignal },
): Promise<{ entries: Record<string, unknown>[]; error?: string }> {
  try {
    const hits = await ports.searchCommunityPackages({
      query: input.query,
      limit: COMMUNITY_PACKAGE_SEARCH_LIMIT,
      signal: input.signal,
    });
    return {
      entries: hits
        .filter((hit) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(hit.name))
        .map(describeHit),
    };
  } catch (error) {
    return { entries: [], error: formatError(error) };
  }
}

function packageSource(entryId: string): { source: MarketplacePiPackageSource; name: string } | undefined {
  if (entryId.startsWith('npm:')) {
    const packageName = entryId.slice('npm:'.length);
    return { source: { kind: 'npm', packageName }, name: packageName };
  }
  if (entryId.startsWith('github:')) {
    const ownerRepo = entryId.slice('github:'.length);
    return {
      source: { kind: 'git', repositoryUrl: `https://github.com/${ownerRepo}` },
      name: ownerRepo.split('/').at(-1) ?? ownerRepo,
    };
  }
  return undefined;
}

/** Installs an `npm:` / `github:` Pi package id; undefined when the id is not one. */
export async function installCommunityPackage(
  entryId: string,
  input: {
    piwinRoot: string;
    agentDirectory: string;
    ports: CommunityPackagePorts;
    applyAfterTurn: (label: string) => Promise<ToolResult>;
  },
): Promise<ToolResult | undefined> {
  const parsed = packageSource(entryId);
  if (!parsed) return undefined;
  if (EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(parsed.name)) {
    return {
      ok: false,
      code: 'invalid-input',
      message: `"${parsed.name}" duplicates a capability piwin already has natively (MCP / subagents); it is not installed.`,
    };
  }
  let source: string;
  try {
    source = resolvePiPackageSource(parsed.source);
  } catch (error) {
    return { ok: false, code: 'invalid-input', message: formatError(error) };
  }
  try {
    await input.ports.installPiPackage({
      source,
      workingDirectory: input.piwinRoot,
      agentDirectory: input.agentDirectory,
    });
  } catch (error) {
    return { ok: false, code: 'execution-failed', message: `Installing "${entryId}" failed: ${formatError(error)}` };
  }
  return input.applyAfterTurn(`community extension package "${parsed.name}"`);
}

/**
 * Default package search: npm `pi-package` first, then GitHub `topic:pi-package`
 * minus repos an npm hit already covers. Throws only when both sources fail.
 */
export async function searchPiPackageSources(
  input: { query: string; limit: number; signal: AbortSignal },
  sources: {
    npm: (options: { query: string; limit: number; signal: AbortSignal }) => Promise<MarketplaceSearchHit[]>;
    github: (options: { query: string; limit: number; signal: AbortSignal }) => Promise<MarketplaceSearchHit[]>;
  },
): Promise<MarketplaceSearchHit[]> {
  const [npm, github] = await Promise.allSettled([sources.npm(input), sources.github(input)]);
  if (npm.status === 'rejected' && github.status === 'rejected') throw npm.reason;
  const npmHits = npm.status === 'fulfilled' ? npm.value : [];
  const repoKey = (url: string | undefined) => url?.replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
  const covered = new Set(npmHits.map((hit) => repoKey(hit.repositoryUrl)).filter(Boolean));
  const githubHits = (github.status === 'fulfilled' ? github.value : []).filter(
    (hit) => !covered.has(repoKey(hit.repositoryUrl)),
  );
  return [...npmHits, ...githubHits].slice(0, input.limit);
}
