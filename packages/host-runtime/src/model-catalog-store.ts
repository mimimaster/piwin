/**
 * Persist / load the Host models.dev reference catalog under ~/.piwin.
 * Never auto-fetches. Invalid files leave the in-memory Pi bootstrap in place.
 *
 * Lookup order: user cache → packaged snapshot → Pi builtins.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  getModelCatalogStatus,
  installModelCatalogSnapshot,
  type ModelCatalogSnapshot,
} from '@piwin/agent-host';
import type {
  ImageModelCatalogEntry,
  ModelCatalogEntry,
  ModelCatalogStatus,
  ModelCatalogSyncResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';
import { getPiwinModelCatalogPath, getPiwinRoot } from './paths.js';

export { getPiwinModelCatalogPath };
import { MODELS_DEV_API_URL, projectModelsDevApi } from './models-dev-map.js';
import { fetchCatalogGet, type ProxyFetch } from './system-proxy-fetch.js';

export const MODEL_CATALOG_SYNC_TIMEOUT_MS = 30_000;
const BUNDLED_CATALOG_LAYOUT = 'model-catalog/model-catalog.json';

type StoredCatalogSnapshot = {
  source: 'models.dev';
  fetchedAt: string;
  apiUrl: string;
  catalogVersion: string;
  entries: ModelCatalogEntry[];
  imageEntries: ImageModelCatalogEntry[];
};

export function loadModelCatalogFromDisk(rootDir?: string): ModelCatalogStatus {
  const userPath = getPiwinModelCatalogPath(getPiwinRoot(rootDir));
  if (installSnapshotFile(userPath)) {
    return getModelCatalogStatus();
  }
  const bundledPath = resolveBundledAssetsRoot({
    layoutPath: BUNDLED_CATALOG_LAYOUT,
    moduleUrl: import.meta.url,
    relativeFallback: `../bundled/${BUNDLED_CATALOG_LAYOUT}`,
  });
  installSnapshotFile(bundledPath);
  return getModelCatalogStatus();
}

function installSnapshotFile(path: string): boolean {
  try {
    const raw = readFileSync(path, 'utf8');
    const snapshot = parseStoredSnapshot(JSON.parse(raw) as unknown);
    if (!snapshot) return false;
    installModelCatalogSnapshot(toInstallable(snapshot));
    return true;
  } catch {
    return false;
  }
}

export type SyncModelCatalogDependencies = {
  rootDir?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  apiUrl?: string;
  /** Test seam. Production reads env, then the OS system proxy, else direct. */
  proxyFetch?: ProxyFetch;
};

export async function syncModelCatalogFromModelsDev(
  dependencies: SyncModelCatalogDependencies = {},
): Promise<ModelCatalogSyncResult> {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation && !dependencies.proxyFetch) {
    throw new ModelCatalogSyncError('Model catalog sync is unavailable: fetch is not supported');
  }
  const apiUrl = dependencies.apiUrl?.trim() || MODELS_DEV_API_URL;
  const clock = dependencies.now ?? ((): Date => new Date());
  const fetchedAt = clock().toISOString();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), MODEL_CATALOG_SYNC_TIMEOUT_MS);
  let payload: unknown;
  try {
    const response = dependencies.proxyFetch
      ? await dependencies.proxyFetch(apiUrl, { signal: abortController.signal })
      : dependencies.fetch
        ? await directFetch(dependencies.fetch, apiUrl, abortController.signal)
        : await fetchCatalogGet(apiUrl, { signal: abortController.signal });
    if (!response.ok) {
      throw new ModelCatalogSyncError(
        `${apiUrl}: ${response.status} ${response.statusText || 'request rejected'}`.trim(),
      );
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof ModelCatalogSyncError) {
      throw error;
    }
    if (abortController.signal.aborted) {
      throw new ModelCatalogSyncError(`timed out after 30 seconds (${apiUrl})`);
    }
    throw new ModelCatalogSyncError(`${apiUrl}: ${formatError(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  const projected = projectModelsDevApi(payload);
  if (projected.entries.length === 0) {
    throw new ModelCatalogSyncError('empty or unrecognized payload');
  }

  const stored: StoredCatalogSnapshot = {
    source: 'models.dev',
    fetchedAt,
    apiUrl,
    catalogVersion: `models.dev@${fetchedAt}`,
    entries: projected.entries,
    imageEntries: projected.imageEntries,
  };
  const root = getPiwinRoot(dependencies.rootDir);
  await writeStoredSnapshot(getPiwinModelCatalogPath(root), stored);
  installModelCatalogSnapshot(toInstallable(stored));
  return { ...getModelCatalogStatus(), ok: true };
}

async function directFetch(
  fetchImplementation: typeof globalThis.fetch,
  apiUrl: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }> {
  const response = await fetchImplementation(apiUrl, {
    method: 'GET',
    signal,
    headers: { accept: 'application/json' },
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<unknown>,
  };
}

export class ModelCatalogSyncError extends Error {
  readonly name = 'ModelCatalogSyncError';

  constructor(message: string) {
    super(message);
  }
}

function toInstallable(stored: StoredCatalogSnapshot): ModelCatalogSnapshot {
  return {
    source: stored.source,
    catalogVersion: stored.catalogVersion,
    fetchedAt: stored.fetchedAt,
    entries: stored.entries,
    imageEntries: stored.imageEntries,
  };
}

function parseStoredSnapshot(value: unknown): StoredCatalogSnapshot | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.source !== 'models.dev') return undefined;
  if (typeof record.fetchedAt !== 'string' || record.fetchedAt.trim().length === 0) {
    return undefined;
  }
  if (typeof record.apiUrl !== 'string' || record.apiUrl.trim().length === 0) {
    return undefined;
  }
  if (typeof record.catalogVersion !== 'string' || record.catalogVersion.trim().length === 0) {
    return undefined;
  }
  if (!Array.isArray(record.entries) || !Array.isArray(record.imageEntries)) {
    return undefined;
  }
  return {
    source: 'models.dev',
    fetchedAt: record.fetchedAt,
    apiUrl: record.apiUrl,
    catalogVersion: record.catalogVersion,
    entries: record.entries as ModelCatalogEntry[],
    imageEntries: record.imageEntries as ImageModelCatalogEntry[],
  };
}

async function writeStoredSnapshot(path: string, snapshot: StoredCatalogSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await rename(tmpPath, path);
}
