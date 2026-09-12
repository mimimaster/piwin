import type { MarketplaceSearchHit } from '@piwin/contracts';
import { normalizeRepositoryUrl } from './search-pi-packages.js';

export const GITHUB_REPO_SEARCH_URL = 'https://api.github.com/search/repositories';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FETCH_TIMEOUT_MS = 8_000;
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type SearchPiGithubOptions = {
  query: string;
  limit?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  token?: string;
};

export function piGitInstallCommand(ownerRepo: string): string {
  return `pi install git:github.com/${ownerRepo}`;
}

export function sanitizeGithubSearchText(query: string): string {
  return query
    .replace(/[^\w./@+\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function hitFromRepo(value: unknown): MarketplaceSearchHit | undefined {
  const repo = asRecord(value);
  if (!repo) return undefined;
  const fullName = readString(repo, 'full_name');
  const htmlUrl = readString(repo, 'html_url');
  if (!fullName || !OWNER_REPO.test(fullName) || !htmlUrl) return undefined;
  const owner = asRecord(repo.owner);
  const name = readString(repo, 'name') ?? fullName;
  const description = readString(repo, 'description') ?? '';
  const defaultBranch = readString(repo, 'default_branch') ?? 'HEAD';
  const repositoryUrl = normalizeRepositoryUrl(htmlUrl) ?? htmlUrl;
  const hit: MarketplaceSearchHit = {
    entryId: `github:${fullName}`,
    name,
    version: defaultBranch,
    description,
    source: 'github',
    installCommand: piGitInstallCommand(fullName),
    repositoryUrl,
  };
  const publisher = owner ? readString(owner, 'login') : undefined;
  if (publisher) hit.publisher = publisher;
  const homepage = readString(repo, 'homepage');
  if (homepage) hit.homepage = homepage;
  return hit;
}

async function fetchGithubJson(
  url: string,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  token: string | undefined,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'piwin-marketplace',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchFn(url, { headers, signal: combined });
  if (!response.ok) {
    throw new Error(`GitHub search failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Search GitHub repos tagged `topic:pi-package`.
 * These are often git-only Pi packages that never appear on npm / pi.dev.
 */
export async function searchPiGithubRepos(
  options: SearchPiGithubOptions,
): Promise<MarketplaceSearchHit[]> {
  const query = sanitizeGithubSearchText(options.query);
  if (!query) return [];
  const fetchFn = options.fetch ?? fetch;
  const limit = clampLimit(options.limit);
  const searchUrl = new URL(GITHUB_REPO_SEARCH_URL);
  searchUrl.searchParams.set('q', `topic:pi-package ${query}`);
  searchUrl.searchParams.set('per_page', String(limit));
  searchUrl.searchParams.set('sort', 'stars');

  const payload = await fetchGithubJson(
    searchUrl.toString(),
    fetchFn,
    options.signal,
    options.token,
  );
  const record = asRecord(payload);
  const items = record && Array.isArray(record.items) ? record.items : [];
  const hits: MarketplaceSearchHit[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const hit = hitFromRepo(item);
    if (!hit || seen.has(hit.entryId)) continue;
    seen.add(hit.entryId);
    hits.push(hit);
  }
  return hits;
}
