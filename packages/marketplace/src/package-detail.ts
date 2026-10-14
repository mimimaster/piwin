/**
 * Read-only details for one live-search hit: README, license and last update
 * from the npm registry and/or GitHub. Nothing here installs or executes code;
 * the README is returned raw and clients render it as untrusted markdown.
 */
import type { MarketplacePackageDetailData } from '@piwin/contracts';
import { NPM_REGISTRY_URL, isNpmPackageName, normalizeRepositoryUrl } from './search-pi-packages.js';

const FETCH_TIMEOUT_MS = 8_000;
/** Enough for any real README; keeps a hostile document from bloating the IPC payload. */
export const MAX_README_CHARS = 200_000;
const GITHUB_REPO_PATH = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/;

export type FetchPackageDetailOptions = {
  entryId: string;
  npmPackageName?: string;
  repositoryUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  githubToken?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function truncateReadme(readme: string): string {
  return readme.length > MAX_README_CHARS ? `${readme.slice(0, MAX_README_CHARS)}\n\n…` : readme;
}

/** `owner/repo` for a https://github.com/<owner>/<repo> URL, else undefined. */
export function githubOwnerRepo(repositoryUrl: string | undefined): string | undefined {
  const normalized = repositoryUrl ? normalizeRepositoryUrl(repositoryUrl) : undefined;
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.hostname.toLowerCase() !== 'github.com') return undefined;
  const match = GITHUB_REPO_PATH.exec(url.pathname);
  if (!match?.[1] || !match[2] || match[2] === '.' || match[2] === '..') return undefined;
  return `${match[1]}/${match[2]}`;
}

async function fetchWithTimeout(
  url: string,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchFn(url, { headers, signal: combined });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).hostname}`);
  return response;
}

type PartialDetail = Omit<MarketplacePackageDetailData, 'entryId' | 'remoteError'>;

async function readNpmDetail(
  packageName: string,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<PartialDetail & { repositoryUrl?: string }> {
  const encoded = packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);
  const response = await fetchWithTimeout(`${NPM_REGISTRY_URL}/${encoded}`, fetchFn, signal, {
    Accept: 'application/json',
  });
  const doc = asRecord(await response.json());
  const latest = readString(asRecord(doc?.['dist-tags']), 'latest');
  const versions = asRecord(doc?.versions);
  const latestDoc = latest && versions ? asRecord(versions[latest]) : null;
  const time = asRecord(doc?.time);
  const repository = asRecord(latestDoc?.repository) ?? asRecord(doc?.repository);
  const readme = readString(doc, 'readme') ?? readString(latestDoc, 'readme');
  const license = readString(latestDoc, 'license') ?? readString(doc, 'license');
  const updatedAt = readString(time, 'modified') ?? (latest ? readString(time, latest) : undefined);
  const repositoryUrl = normalizeRepositoryUrl(readString(repository, 'url') ?? '');
  return {
    ...(readme ? { readme } : {}),
    ...(license ? { license } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
  };
}

async function readGithubDetail(
  ownerRepo: string,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  token: string | undefined,
): Promise<PartialDetail> {
  const headers: Record<string, string> = {
    'User-Agent': 'piwin-marketplace',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const [repoOutcome, readmeOutcome] = await Promise.allSettled([
    fetchWithTimeout(`https://api.github.com/repos/${ownerRepo}`, fetchFn, signal, {
      ...headers,
      Accept: 'application/vnd.github+json',
    }).then(async (response) => asRecord(await response.json())),
    fetchWithTimeout(`https://api.github.com/repos/${ownerRepo}/readme`, fetchFn, signal, {
      ...headers,
      Accept: 'application/vnd.github.raw+json',
    }).then((response) => response.text()),
  ]);
  if (repoOutcome.status === 'rejected' && readmeOutcome.status === 'rejected') {
    throw repoOutcome.reason;
  }
  const repo = repoOutcome.status === 'fulfilled' ? repoOutcome.value : null;
  const readme = readmeOutcome.status === 'fulfilled' ? readmeOutcome.value.trim() : '';
  const license = readString(asRecord(repo?.license), 'spdx_id');
  const updatedAt = readString(repo, 'pushed_at') ?? readString(repo, 'updated_at');
  return {
    ...(readme ? { readme } : {}),
    ...(license && license !== 'NOASSERTION' ? { license } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * npm first (registry README is what `pi install npm:` ships), then GitHub to
 * fill whatever npm lacked. Source failures become `remoteError`, not throws.
 */
export async function fetchPackageDetail(
  options: FetchPackageDetailOptions,
): Promise<MarketplacePackageDetailData> {
  const fetchFn = options.fetch ?? fetch;
  const errors: string[] = [];
  let detail: PartialDetail = {};
  let repositoryUrl = options.repositoryUrl;

  const npmName = options.npmPackageName?.trim();
  if (npmName && isNpmPackageName(npmName)) {
    try {
      const npm = await readNpmDetail(npmName, fetchFn, options.signal);
      const { repositoryUrl: npmRepository, ...rest } = npm;
      detail = rest;
      repositoryUrl ??= npmRepository;
    } catch (error) {
      errors.push(`npm: ${describeError(error)}`);
    }
  }

  const ownerRepo = githubOwnerRepo(repositoryUrl);
  if (ownerRepo && (!detail.readme || !detail.license || !detail.updatedAt)) {
    try {
      const github = await readGithubDetail(ownerRepo, fetchFn, options.signal, options.githubToken);
      detail = {
        ...github,
        ...detail,
      };
    } catch (error) {
      errors.push(`GitHub: ${describeError(error)}`);
    }
  }

  return {
    entryId: options.entryId,
    ...(detail.readme ? { readme: truncateReadme(detail.readme) } : {}),
    ...(detail.license ? { license: detail.license } : {}),
    ...(detail.updatedAt ? { updatedAt: detail.updatedAt } : {}),
    ...(errors.length > 0 ? { remoteError: errors.join('; ') } : {}),
  };
}
