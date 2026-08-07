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
  /**
   * Discovered models that look image-capable but did not match any Pi catalog
   * entry (common for SiliconFlow / local gateways whose ids differ from
   * OpenRouter catalog ids). Always surface these in the primary dropdown.
   */
  discoveredOnly: Array<{
    modelId: string;
    label: string;
  }>;
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
  options?: {
    /** Optional labels keyed by discovered id (for discoveredOnly display). */
    labelsById?: ReadonlyMap<string, string> | Record<string, string>;
    /** Optional capability tags keyed by discovered id. */
    capabilitiesById?: ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>;
  },
): SuggestionResult {
  // Build a lookup: lowercased split-name → original discovered id.
  const bySplitName = new Map<string, string>();
  const byFullId = new Map<string, string>();
  const normalizedDiscovered = new Map<string, string>();
  for (const id of discoveredIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    byFullId.set(trimmed.toLowerCase(), trimmed);
    const name = splitModelName(trimmed).toLowerCase();
    if (!bySplitName.has(name)) {
      bySplitName.set(name, trimmed);
    }
    const normalized = normalizeModelToken(name);
    if (normalized && !normalizedDiscovered.has(normalized)) {
      normalizedDiscovered.set(normalized, trimmed);
    }
  }

  const matched: SuggestionMatch[] = [];
  const unmatched: ImageModelCatalogEntry[] = [];
  const matchedDiscoveredIds = new Set<string>();

  for (const entry of catalog) {
    const fullIdLower = entry.modelId.toLowerCase();
    const splitNameLower = splitModelName(entry.modelId).toLowerCase();
    const normalizedCatalog = normalizeModelToken(splitNameLower);

    // Prefer exact full-id match, then split-name match.
    const exact = byFullId.get(fullIdLower);
    const byName = bySplitName.get(splitNameLower);
    const byNormalized = normalizedCatalog
      ? normalizedDiscovered.get(normalizedCatalog)
      : undefined;
    // Family match: catalog "flux.2-pro" ↔ discovered "FLUX.1-schnell".
    // Skip discovered ids already claimed by a stronger/earlier match so one
    // SiliconFlow FLUX model does not light up every flux.* catalog row.
    const byFamily = matchImageFamily(splitNameLower, bySplitName, matchedDiscoveredIds);
    const matchedId = exact ?? byName ?? byNormalized ?? byFamily;

    if (matchedId) {
      matched.push({ entry, matchedId });
      matchedDiscoveredIds.add(matchedId.toLowerCase());
    } else {
      unmatched.push(entry);
    }
  }

  const labelsById = toStringMap(options?.labelsById);
  const capabilitiesById = toStringArrayMap(options?.capabilitiesById);
  const discoveredOnly: SuggestionResult['discoveredOnly'] = [];
  for (const id of discoveredIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    if (matchedDiscoveredIds.has(trimmed.toLowerCase())) continue;
    const label = labelsById.get(trimmed) ?? labelsById.get(trimmed.toLowerCase()) ?? trimmed;
    const capabilities =
      capabilitiesById.get(trimmed) ?? capabilitiesById.get(trimmed.toLowerCase()) ?? [];
    if (!isLikelyImageGenerationModel(trimmed, label, capabilities)) {
      continue;
    }
    discoveredOnly.push({ modelId: trimmed, label });
  }

  return { matched, unmatched, discoveredOnly };
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

/**
 * Heuristic: does this discovered model look like an image-generation model?
 * Used when provider ids do not line up with Pi's OpenRouter-centric catalog.
 */
export function isLikelyImageGenerationModel(
  modelId: string,
  label?: string,
  capabilities?: readonly string[],
): boolean {
  if (capabilities?.includes('image-generation')) {
    return true;
  }
  const haystack = `${modelId} ${label ?? ''}`.toLowerCase();
  return IMAGE_MODEL_HINT_PATTERN.test(haystack);
}

/** Strip punctuation so "flux.2-pro" and "flux-2-pro" compare equal. */
function normalizeModelToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Match catalog split-name family against discovered split names.
 * e.g. catalog `flux.2-pro` family `flux` → discovered `FLUX.1-schnell`.
 */
function matchImageFamily(
  catalogSplitName: string,
  discoveredBySplitName: Map<string, string>,
  alreadyMatchedDiscoveredIds: Set<string>,
): string | undefined {
  const family = extractImageFamilyToken(catalogSplitName);
  if (!family) return undefined;
  for (const [discoveredName, discoveredId] of discoveredBySplitName) {
    if (alreadyMatchedDiscoveredIds.has(discoveredId.toLowerCase())) {
      continue;
    }
    const discoveredFamily = extractImageFamilyToken(discoveredName);
    if (discoveredFamily && discoveredFamily === family) {
      return discoveredId;
    }
    // Also accept discovered names that start with the family token.
    if (
      discoveredName === family ||
      discoveredName.startsWith(`${family}.`) ||
      discoveredName.startsWith(`${family}-`)
    ) {
      return discoveredId;
    }
  }
  return undefined;
}

function extractImageFamilyToken(splitName: string): string | undefined {
  const lower = splitName.toLowerCase();
  // Prefer known image families over the raw first token (avoids matching "google").
  for (const family of KNOWN_IMAGE_FAMILIES) {
    if (lower === family || lower.startsWith(`${family}.`) || lower.startsWith(`${family}-`) || lower.startsWith(family)) {
      // Require the family to appear as a prefix-ish token, not a mid-string accident
      // for very short families already guarded by the list.
      if (lower.startsWith(family)) {
        return family;
      }
    }
  }
  return undefined;
}

const KNOWN_IMAGE_FAMILIES = [
  'flux',
  'seedream',
  'recraft',
  'gpt-image',
  'gptimage',
  'dall-e',
  'dalle',
  'stable-diffusion',
  'sdxl',
  'sd3',
  'imagen',
  'ideogram',
  'kolors',
  'cogview',
  'wanx',
  'qwen-image',
  'grok-imagine',
  'riverflow',
  'mai-image',
] as const;

/**
 * Tokens that strongly suggest an image-generation model id/label.
 * Deliberately broad for Chinese gateways (SiliconFlow, etc.).
 */
const IMAGE_MODEL_HINT_PATTERN =
  /(?:^|[^a-z0-9])(?:gpt-?image|dall-?e|dalle|flux|kolors|seedream|recraft|stable-?diffusion|sdxl|sd-?3|midjourney|imagen|ideogram|cogview|wanx|qwen-?image|hunyuan-?image|playground|cascade|kandinsky|aura-?flow|riverflow|grok-?imagine|mai-?image|janus|bagel|image-gen|text2image|txt2img|t2i)(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])(?:image)(?:[^a-z0-9]|$)/i;

function toStringMap(
  value: ReadonlyMap<string, string> | Record<string, string> | undefined,
): Map<string, string> {
  if (!value) return new Map();
  if (value instanceof Map) return new Map(value);
  return new Map(Object.entries(value));
}

function toStringArrayMap(
  value:
    | ReadonlyMap<string, readonly string[]>
    | Record<string, readonly string[]>
    | undefined,
): Map<string, readonly string[]> {
  if (!value) return new Map();
  if (value instanceof Map) return new Map(value);
  return new Map(Object.entries(value));
}
