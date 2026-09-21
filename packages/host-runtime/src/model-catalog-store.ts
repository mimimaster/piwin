/**
 * Persist / load the Host models.dev reference catalog under ~/.piwin.
 * Never auto-fetches. Invalid files leave the in-memory Pi bootstrap in place.
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
import { getPiwinModelCatalogPath, getPiwinRoot } from './paths.js';

export { getPiwinModelCatalogPath };
import { MODELS_DEV_API_URL, projectModelsDevApi } from './models-dev-map.js';

export const MODEL_CATALOG_SYNC_TIMEOUT_MS = 30_000;


type StoredCatalogSnapshot = {
  source: 'models.dev';
  fetchedAt: string;
  apiUrl: string;
  catalogVersion: string;
  entries: ModelCatalogEntry[];
  imageEntries: ImageModelCatalogEntry[];
};

export function loadModelCatalogFromDisk(rootDir?: string): ModelCatalogStatus {
  const path = getPiwinModelCatalogPath(getPiwinRoot(rootDir));
  try {
    const raw = readFileSync(path, 'utf8');
    const snapshot = parseStoredSnapshot(JSON.parse(raw) as unknown);
    if (!snapshot) {
      return getModelCatalogStatus();
    }
    installModelCatalogSnapshot(toInstallable(snapshot));
  } catch {
    // Missing or unreadable: keep Pi bootstrap.
  }
  return getModelCatalogStatus();
}

export type SyncModelCatalogDependencies = {
  rootDir?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  apiUrl?: string;
};

export async function syncModelCatalogFromModelsDev(
  dependencies: SyncModelCatalogDependencies = {},
): Promise<ModelCatalogSyncResult> {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new ModelCatalogSyncError('Model catalog sync is unavailable: fetch is not supported');
  }
  const apiUrl = dependencies.apiUrl?.trim() || MODELS_DEV_API_URL;
  const clock = dependencies.now ?? ((): Date => new Date());
  const fetchedAt = clock().toISOString();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), MODEL_CATALOG_SYNC_TIMEOUT_MS);
  let payload: unknown;
  try {
    const response = await fetchImplementation(apiUrl, {
      method: 'GET',
      signal: abortController.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new ModelCatalogSyncError(
        `Model catalog sync failed (${response.status} ${response.statusText || 'request rejected'})`.trim(),
      );
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof ModelCatalogSyncError) {
      throw error;
    }
    if (abortController.signal.aborted) {
      throw new ModelCatalogSyncError('Model catalog sync timed out after 30 seconds');
    }
    throw new ModelCatalogSyncError(`Model catalog sync failed: ${formatError(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  const projected = projectModelsDevApi(payload);
  if (projected.entries.length === 0) {
    throw new ModelCatalogSyncError('Model catalog sync failed: empty or unrecognized payload');
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

