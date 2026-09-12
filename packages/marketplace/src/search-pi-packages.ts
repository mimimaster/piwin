import type { MarketplaceSearchHit } from '@piwin/contracts';

export const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
export const PI_PACKAGE_KEYWORD = 'pi-package';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FETCH_TIMEOUT_MS = 8_000;

const NPM_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export type SearchPiPackagesOptions = {
  query: string;
  limit?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

export function isNpmPackageName(value: string): boolean {
  return NPM_NAME.test(value.trim());
}

export function npmPackagePageUrl(name: string): string {
  return `https://www.npmjs.com/package/${name}`;
}

export function piInstallCommand(name: string): string {
  return `pi install npm:${name}`;
}

export function normalizeRepositoryUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let url = trimmed.replace(/^git\+/, '');
  if (url.startsWith('git://')) {
    url = `https://${url.slice('git://'.length)}`;
  }
  if (url.startsWith('github.com/')) {
    url = `https://${url}`;
  }
  url = url.replace(/\.git$/i, '');
  if (!/^https?:\/\//i.test(url)) return undefined;
  return url;
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

function keywordsIncludePiPackage(keywords: unknown): boolean {
  if (!Array.isArray(keywords)) return false;
  return keywords.some(
    (item) => typeof item === 'string' && item.toLowerCase() === PI_PACKAGE_KEYWORD,
  );
}

function hitFromPackageFields(input: {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repositoryUrl?: string;
  publisher?: string;
  monthlyDownloads?: number;
}): MarketplaceSearchHit {
  const hit: MarketplaceSearchHit = {
    entryId: `npm:${input.name}`,
    name: input.name,
    version: input.version,
    description: input.description,
    source: 'npm-pi-package',
    installCommand: piInstallCommand(input.name),
    npmUrl: npmPackagePageUrl(input.name),
  };
  if (input.homepage) hit.homepage = input.homepage;
  if (input.repositoryUrl) hit.repositoryUrl = input.repositoryUrl;
  if (input.publisher) hit.publisher = input.publisher;
  if (input.monthlyDownloads !== undefined) hit.monthlyDownloads = input.monthlyDownloads;
  return hit;
}

function hitFromSearchObject(value: unknown): MarketplaceSearchHit | undefined {
  const object = asRecord(value);
  if (!object) return undefined;
  const pkg = asRecord(object.package);
  if (!pkg) return undefined;
  const name = readString(pkg, 'name');
  if (!name || !isNpmPackageName(name)) return undefined;
  if (!keywordsIncludePiPackage(pkg.keywords)) return undefined;
  const links = asRecord(pkg.links);
  const publisher = asRecord(pkg.publisher);
  const downloads = asRecord(object.downloads);
  const monthly =
    downloads && typeof downloads.monthly === 'number' && Number.isFinite(downloads.monthly)
      ? downloads.monthly
      : undefined;
  const homepage = links ? readString(links, 'homepage') : undefined;
  const repositoryUrl = links
    ? normalizeRepositoryUrl(readString(links, 'repository') ?? '')
    : undefined;
  const publisherName = publisher ? readString(publisher, 'username') : undefined;
  return hitFromPackageFields({
    name,
    version: readString(pkg, 'version') ?? '0.0.0',
    description: readString(pkg, 'description') ?? '',
    ...(homepage ? { homepage } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(publisherName ? { publisher: publisherName } : {}),
    ...(monthly !== undefined ? { monthlyDownloads: monthly } : {}),
  });
}

function hitFromRegistryDoc(value: unknown): MarketplaceSearchHit | undefined {
  const doc = asRecord(value);
  if (!doc) return undefined;
  const name = readString(doc, 'name');
  if (!name || !isNpmPackageName(name)) return undefined;
  const distTags = asRecord(doc['dist-tags']);
  const latest = distTags ? readString(distTags, 'latest') : undefined;
  const versions = asRecord(doc.versions);
  const latestDoc = latest && versions ? asRecord(versions[latest]) : null;
  const keywords = latestDoc?.keywords ?? doc.keywords;
  if (!keywordsIncludePiPackage(keywords)) return undefined;
  const repository = latestDoc ? asRecord(latestDoc.repository) : asRecord(doc.repository);
  const repositoryRaw =
    (repository ? readString(repository, 'url') : undefined) ??
    (typeof latestDoc?.repository === 'string' ? latestDoc.repository : undefined);
  const homepage =
    (latestDoc ? readString(latestDoc, 'homepage') : undefined) ?? readString(doc, 'homepage');
  const description =
    (latestDoc ? readString(latestDoc, 'description') : undefined) ??
    readString(doc, 'description') ??
    '';
  const repositoryUrl = repositoryRaw ? normalizeRepositoryUrl(repositoryRaw) : undefined;
  return hitFromPackageFields({
    name,
    version: latest ?? '0.0.0',
    description,
    ...(homepage ? { homepage } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
  });
}

async function fetchJson(
  url: string,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined =
    signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchFn(url, {
    headers: { Accept: 'application/json' },
    signal: combined,
  });
  if (!response.ok) {
    throw new Error(`npm registry failed: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Search npm for packages tagged `pi-package` — the same index as pi.dev/packages.
 * Does not install anything.
 */
export async function searchPiNpmPackages(
  options: SearchPiPackagesOptions,
): Promise<MarketplaceSearchHit[]> {
  const query = options.query.trim();
  if (!query) return [];
  const fetchFn = options.fetch ?? fetch;
  const limit = clampLimit(options.limit);
  const searchUrl = new URL(NPM_SEARCH_URL);
  searchUrl.searchParams.set('text', `keywords:${PI_PACKAGE_KEYWORD} ${query}`);
  searchUrl.searchParams.set('size', String(limit));

  const searchPayload = await fetchJson(searchUrl.toString(), fetchFn, options.signal);
  const searchRecord = asRecord(searchPayload);
  const objects = searchRecord && Array.isArray(searchRecord.objects) ? searchRecord.objects : [];
  const hits: MarketplaceSearchHit[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const hit = hitFromSearchObject(object);
    if (!hit || seen.has(hit.name)) continue;
    seen.add(hit.name);
    hits.push(hit);
  }

  if (isNpmPackageName(query) && !seen.has(query)) {
    const encoded = query.startsWith('@')
      ? `@${encodeURIComponent(query.slice(1))}`
      : encodeURIComponent(query);
    try {
      const exact = hitFromRegistryDoc(
        await fetchJson(`${NPM_REGISTRY_URL}/${encoded}`, fetchFn, options.signal),
      );
      if (exact && !seen.has(exact.name)) {
        hits.unshift(exact);
      }
    } catch {
      // Search hits are enough when the exact lookup 404s or times out.
    }
  }

  return hits.slice(0, limit);
}
