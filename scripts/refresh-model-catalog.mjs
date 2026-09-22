/**
 * Refresh the catalog shipped with the repo and the Host bundle.
 * Run from a network that can reach https://models.dev/api.json.
 * Output matches the snapshot Host loads from ~/.piwin and bundled-assets.
 *
 *   node scripts/refresh-model-catalog.mjs
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS_DEV_API_URL, projectModelsDevApi } from '../packages/host-runtime/src/models-dev-map.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(
  root,
  'packages/host-runtime/bundled/model-catalog/model-catalog.json',
);

const response = await fetch(MODELS_DEV_API_URL, { headers: { accept: 'application/json' } });
if (!response.ok) {
  throw new Error(`catalog refresh failed: ${response.status} ${response.statusText}`);
}
const projected = projectModelsDevApi(await response.json());
if (projected.entries.length === 0) {
  throw new Error('catalog refresh failed: empty or unrecognized payload');
}

const fetchedAt = new Date().toISOString();
const stored = {
  source: 'models.dev',
  fetchedAt,
  apiUrl: MODELS_DEV_API_URL,
  catalogVersion: `models.dev@${fetchedAt}`,
  entries: projected.entries,
  imageEntries: projected.imageEntries,
};
await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.tmp`;
await writeFile(temporary, `${JSON.stringify(stored)}\n`, 'utf8');
await rename(temporary, destination);
console.log(
  `[model-catalog] wrote ${destination} (${stored.entries.length} models, ${stored.imageEntries.length} image)`,
);
