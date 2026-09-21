/**
 * Project https://models.dev/api.json into piwin catalog entries.
 * Pure: no I/O. Unknown / malformed providers are skipped.
 */
import type { ImageModelCatalogEntry, ModelCatalogEntry, ModelInputModality } from '@piwin/contracts';

export const MODELS_DEV_API_URL = 'https://models.dev/api.json';

export type ModelsDevCatalogProjection = {
  entries: ModelCatalogEntry[];
  imageEntries: ImageModelCatalogEntry[];
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

export function projectModelsDevApi(payload: unknown): ModelsDevCatalogProjection {
  const providers = asRecord(payload);
  const entries: ModelCatalogEntry[] = [];
  const imageEntries: ImageModelCatalogEntry[] = [];
  if (!providers) {
    return { entries, imageEntries };
  }

  for (const [providerKey, providerValue] of Object.entries(providers)) {
    const catalogProviderId = providerKey.trim();
    if (!catalogProviderId) continue;
    const provider = asRecord(providerValue);
    const models = asRecord(provider?.models);
    if (!models) continue;

    for (const modelValue of Object.values(models)) {
      const mapped = mapModel(catalogProviderId, modelValue);
      if (!mapped) continue;
      entries.push(mapped.entry);
      if (mapped.imageEntry) {
        imageEntries.push(mapped.imageEntry);
      }
    }
  }

  return { entries, imageEntries };
}

function mapModel(
  catalogProviderId: string,
  value: unknown,
): { entry: ModelCatalogEntry; imageEntry?: ImageModelCatalogEntry } | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const modelId = readNonEmptyString(record.id);
  if (!modelId) return undefined;
  const name = readNonEmptyString(record.name) ?? modelId;
  const modalities = asRecord(record.modalities);
  const input = mapModalities(modalities?.input, ['text']);
  const output = mapModalities(modalities?.output, []);
  const limits = asRecord(record.limit);
  const cost = asRecord(record.cost);
  const entry: ModelCatalogEntry = {
    catalogProviderId,
    modelId,
    name,
    input,
    reasoning: record.reasoning === true,
    contextWindow: positiveInt(limits?.context) ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: positiveInt(limits?.output) ?? DEFAULT_MAX_TOKENS,
    cost: {
      input: finiteNumber(cost?.input) ?? 0,
      output: finiteNumber(cost?.output) ?? 0,
      cacheRead: finiteNumber(cost?.cache_read) ?? 0,
      cacheWrite: finiteNumber(cost?.cache_write) ?? 0,
    },
  };
  if (!output.includes('image')) {
    return { entry };
  }
  return {
    entry,
    imageEntry: {
      catalogProviderId,
      modelId,
      name,
      input,
      output: output.length > 0 ? output : ['image'],
    },
  };
}

function mapModalities(value: unknown, fallback: ModelInputModality[]): ModelInputModality[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const next = value.filter(
    (item): item is ModelInputModality => item === 'text' || item === 'image',
  );
  return next.length > 0 ? next : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined || number <= 0 || !Number.isSafeInteger(number)) {
    return undefined;
  }
  return number;
}
