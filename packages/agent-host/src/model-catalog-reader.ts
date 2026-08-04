/**
 * Project Pi's static built-in catalog into piwin contracts (no apps → pi-ai).
 * Uses `@earendil-works/pi-ai/providers/all` (MODELS is not on the package root export).
 */
import { createRequire } from 'node:module';
import { builtinImagesProviders, getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type {
  ImageModelCatalogEntry,
  ImageModelCatalogSearchResult,
  ModelCatalogEntry,
  ModelCatalogSearchRequest,
  ModelCatalogSearchResult,
  ModelInputModality,
} from '@piwin/contracts';

const require = createRequire(import.meta.url);

function readCatalogVersion(): string {
  try {
    const pkg = require('@earendil-works/pi-ai/package.json') as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function flattenCatalog(): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  for (const catalogProviderId of getBuiltinProviders()) {
    const models = getBuiltinModels(catalogProviderId);
    for (const model of models) {
      if (!model || typeof model.id !== 'string' || !model.id) {
        continue;
      }
      const rawInput = Array.isArray(model.input) ? model.input : ['text'];
      const input: ModelInputModality[] = rawInput.filter(
        (item): item is ModelInputModality => item === 'text' || item === 'image',
      );
      entries.push({
        catalogProviderId,
        modelId: model.id,
        name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : model.id,
        input: input.length > 0 ? input : ['text'],
        reasoning: model.reasoning === true,
        contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : 128_000,
        maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : 8_192,
        cost: {
          input: model.cost?.input ?? 0,
          output: model.cost?.output ?? 0,
          cacheRead: model.cost?.cacheRead ?? 0,
          cacheWrite: model.cost?.cacheWrite ?? 0,
        },
      });
    }
  }
  return entries;
}

let cachedEntries: ModelCatalogEntry[] | null = null;

function getAllEntries(): ModelCatalogEntry[] {
  if (!cachedEntries) {
    cachedEntries = flattenCatalog();
  }
  return cachedEntries;
}

function scoreMatch(entry: ModelCatalogEntry, query: string): number {
  const q = query.toLowerCase();
  const id = entry.modelId.toLowerCase();
  const name = entry.name.toLowerCase();
  if (id.startsWith(q)) return 300;
  if (name.startsWith(q)) return 200;
  if (id.includes(q) || name.includes(q)) return 100;
  return 0;
}

export function searchPiCatalog(request: ModelCatalogSearchRequest = {}): ModelCatalogSearchResult {
  const limitRaw = request.limit ?? 50;
  const limit = Math.min(200, Math.max(1, Math.floor(limitRaw)));
  const query = request.query?.trim() ?? '';
  const catalogProviderId = request.catalogProviderId?.trim();
  const inputIncludes = request.inputIncludes;

  let entries = getAllEntries();
  if (catalogProviderId) {
    entries = entries.filter((entry) => entry.catalogProviderId === catalogProviderId);
  }
  if (inputIncludes) {
    entries = entries.filter((entry) => entry.input.includes(inputIncludes));
  }
  if (query) {
    entries = entries
      .map((entry) => ({ entry, score: scoreMatch(entry, query) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const providerCmp = left.entry.catalogProviderId.localeCompare(
          right.entry.catalogProviderId,
        );
        if (providerCmp !== 0) return providerCmp;
        return left.entry.modelId.localeCompare(right.entry.modelId);
      })
      .map((item) => item.entry);
  } else {
    entries = [...entries].sort((left, right) => {
      const providerCmp = left.catalogProviderId.localeCompare(right.catalogProviderId);
      if (providerCmp !== 0) return providerCmp;
      return left.modelId.localeCompare(right.modelId);
    });
  }

  return {
    entries: entries.slice(0, limit),
    catalogVersion: readCatalogVersion(),
  };
}

/** First catalog hit for modelId (any provider). Prefer exact id match. */
export function lookupCatalogByModelId(modelId: string): ModelCatalogEntry | undefined {
  const id = modelId.trim();
  if (!id) return undefined;
  const exact = getAllEntries().find((entry) => entry.modelId === id);
  if (exact) return exact;
  const lower = id.toLowerCase();
  return getAllEntries().find((entry) => entry.modelId.toLowerCase() === lower);
}

/**
 * Fill missing capability/limit fields from catalog. Never overwrites user-set values.
 */
export function enrichFromCatalog<T extends { id: string }>(
  entry: T,
  catalog: ModelCatalogEntry | undefined,
): T & {
  input?: readonly ModelInputModality[];
  reasoning?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  label?: string;
} {
  if (!catalog) {
    return entry;
  }
  const result = { ...entry } as T & {
    input?: readonly ModelInputModality[];
    reasoning?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
    label?: string;
  };
  if (result.input === undefined) {
    result.input = catalog.input;
  }
  if (result.reasoning === undefined) {
    result.reasoning = catalog.reasoning;
  }
  if (result.contextWindow === undefined) {
    result.contextWindow = catalog.contextWindow;
  }
  if (result.maxOutputTokens === undefined) {
    result.maxOutputTokens = catalog.maxTokens;
  }
  if (
    (result as { label?: string }).label === undefined &&
    catalog.name &&
    catalog.name !== catalog.modelId
  ) {
    (result as { label?: string }).label = catalog.name;
  }
  return result;
}


/* ------------------------------------------------------------------ *
 * Image-generation catalog (separate from chat Model catalog)
 * ------------------------------------------------------------------ */

/**
 * Extract the model name segment after the last `/`.
 * e.g. `openai/gpt-image-1` → `gpt-image-1`.
 */
export function splitModelName(modelId: string): string {
  const idx = modelId.lastIndexOf('/');
  return idx >= 0 ? modelId.slice(idx + 1) : modelId;
}

function flattenImagesCatalog(): ImageModelCatalogEntry[] {
  const entries: ImageModelCatalogEntry[] = [];
  for (const provider of builtinImagesProviders()) {
    const providerId = provider.id;
    const models = provider.getModels();
    for (const model of models) {
      const rawInput = Array.isArray(model.input) ? model.input : ['text'];
      const input: ModelInputModality[] = rawInput.filter(
        (item): item is ModelInputModality => item === 'text' || item === 'image',
      );
      const rawOutput = Array.isArray(model.output) ? model.output : ['image'];
      const output: ModelInputModality[] = rawOutput.filter(
        (item): item is ModelInputModality => item === 'text' || item === 'image',
      );
      entries.push({
        catalogProviderId: providerId,
        modelId: model.id,
        name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : model.id,
        input: input.length > 0 ? input : ['text'],
        output: output.length > 0 ? output : ['image'],
      });
    }
  }
  return entries;
}

let cachedImagesEntries: ImageModelCatalogEntry[] | null = null;

function getAllImagesEntries(): ImageModelCatalogEntry[] {
  if (!cachedImagesEntries) {
    cachedImagesEntries = flattenImagesCatalog();
  }
  return cachedImagesEntries;
}

/**
 * Return all Pi built-in image-generation models (static catalog, no network).
 */
export function searchPiImagesCatalog(): ImageModelCatalogSearchResult {
  return {
    entries: getAllImagesEntries(),
    catalogVersion: readCatalogVersion(),
  };
}
