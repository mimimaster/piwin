/**
 * Pi model catalog projection types (static reference from @earendil-works/pi-ai).
 * Apps never import Pi packages; they query via IPC `models/catalog/search`.
 */
import type { ModelInputModality } from './config.js';

export type ModelCatalogEntry = {
  /**
   * Pi catalog provider id (anthropic / openai / …).
   * Display + filter only — never written as piwin provider id.
   */
  catalogProviderId: string;
  modelId: string;
  name: string;
  input: readonly ModelInputModality[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type ModelCatalogSearchRequest = {
  /** Model id or name substring, case-insensitive. Empty = no text filter. */
  query?: string;
  /** Match only this catalog provider (optional). */
  catalogProviderId?: string;
  /** Require input to include this modality (optional). */
  inputIncludes?: ModelInputModality;
  /** Default 50, max 200. */
  limit?: number;
};

export type ModelCatalogSearchResult = {
  entries: ModelCatalogEntry[];
  /** e.g. pi-ai package version. */
  catalogVersion: string;
};

/**
 * Pi image-generation model catalog projection.
 *
 * Pi maintains a separate `ImagesModel` catalog (35 built-in models) distinct
 * from the chat `Model` catalog.  These types mirror the shape needed by the
 * Image Generation settings page — apps fetch via IPC
 * `models/image-catalog/search`.
 */
export type ImageModelCatalogEntry = {
  catalogProviderId: string;
  modelId: string;
  name: string;
  input: readonly ModelInputModality[];
  output: readonly ModelInputModality[];
};

export type ImageModelCatalogSearchResult = {
  entries: ImageModelCatalogEntry[];
  catalogVersion: string;
};

/**
 * Extract the model-name segment after the last `/`.
 * `"openai/gpt-image-1"` → `"gpt-image-1"`.
 */
export function splitModelName(modelId: string): string {
  const index = modelId.lastIndexOf('/');
  return index >= 0 ? modelId.slice(index + 1) : modelId;
}

export type SuggestionMatch = {
  entry: ImageModelCatalogEntry;
  /** The discovered model id that matched (for display). */
  matchedId: string;
};

export type SuggestionResult = {
  /** Pi image models that have a matching discovered model. */
  matched: SuggestionMatch[];
  /** Pi image models with no matching discovered model. */
  unmatched: ImageModelCatalogEntry[];
};

/**
 * Partition Pi image catalog entries into matched / unmatched against
 * a set of discovered model ids. Matching is case-insensitive on the
 * split name segment (after last `/`), or on the full id.
 *
 * Order is preserved from the Pi catalog — no re-sorting.
 */
export function matchImageCatalog(
  catalog: readonly ImageModelCatalogEntry[],
  discoveredIds: readonly string[],
): SuggestionResult {
  // Build a lookup: lowercased split-name → original discovered id.
  const bySplitName = new Map<string, string>();
  const byFullId = new Map<string, string>();
  for (const id of discoveredIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    byFullId.set(trimmed.toLowerCase(), trimmed);
    const name = splitModelName(trimmed).toLowerCase();
    if (!bySplitName.has(name)) {
      bySplitName.set(name, trimmed);
    }
  }

  const matched: SuggestionMatch[] = [];
  const unmatched: ImageModelCatalogEntry[] = [];

  for (const entry of catalog) {
    const fullIdLower = entry.modelId.toLowerCase();
    const splitNameLower = splitModelName(entry.modelId).toLowerCase();

    // Prefer exact full-id match, then split-name match.
    const exact = byFullId.get(fullIdLower);
    const byName = bySplitName.get(splitNameLower);
    const matchedId = exact ?? byName;

    if (matchedId) {
      matched.push({ entry, matchedId });
    } else {
      unmatched.push(entry);
    }
  }

  return { matched, unmatched };
}

/**
 * Filter suggestion entries by a text query (case-insensitive substring
 * on modelId or name). Preserves input order.
 */
export function filterSuggestions<T extends ImageModelCatalogEntry>(
  entries: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(
    (entry) =>
      entry.modelId.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q),
  );
}
