/**
 * Pure matching logic for the image-model suggestion dropdown.
 *
 * Given Pi's built-in image-generation catalog and a list of model ids
 * discovered from the user's provider, split each Pi model id on `/`
 * and check whether the name segment matches any discovered model id
 * (also split on `/` for symmetric comparison).
 */

import type { ImageModelCatalogEntry } from '@piwin/contracts';

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
 * the provider's discovered model ids.  Matching is case-insensitive on
 * the split name segment (after last `/`), or on the full id.
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
 * on modelId or name).  Preserves input order.
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
