/**
 * Pi model catalog projection types (static reference from @earendil-works/pi-ai).
 * Apps never import Pi packages; they query via IPC `models/catalog/search`.
 */
import type {
  ImageGenerationApiStyle,
  ModelInputModality,
  VideoGenerationApiStyle,
} from './config.js';

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
  /(?:^|[^a-z0-9])(?:gpt-?image|dall-?e|dalle|flux|kolors|seedream|step-?image|recraft|stable-?diffusion|sdxl|sd-?3|midjourney|imagen|ideogram|cogview|wanx|qwen-?image|hunyuan-?image|playground|cascade|kandinsky|aura-?flow|riverflow|grok-?imagine-image|mai-?image|janus|bagel|image-gen|text2image|txt2img|t2i)(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])(?:image)(?:[^a-z0-9]|$)/i;

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


/**
 * Curated video-generation model registry entry (ADR 0043).
 * Keyed by provider protocol and exact model id / aliases.
 */
export type VideoGenerationRegistryEntry = {
  /** Optional protocol filter; omit means any protocol. */
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  /** Canonical model id. */
  modelId: string;
  /** Case-insensitive aliases matched against discovered / configured ids. */
  aliases?: readonly string[];
  /** Match `modelId-…` / `modelId.…` variants (grok-imagine-video-1.5-preview). */
  prefix?: boolean;
  /** Display label for settings. */
  label?: string;
  /** Preferred async API style for the Video settings form. */
  apiStyle: VideoGenerationApiStyle;
  /** Default create-task path for the adapter. */
  path?: string;
};

export type ImageGenerationRegistryEntry = {
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  aliases?: readonly string[];
  prefix?: boolean;
  label?: string;
  apiStyle: ImageGenerationApiStyle;
  path?: string;
};

/**
 * Versioned curated registry of known video-generation models.
 * Exact id / alias matches may auto-tag `video-generation`; heuristics only suggest.
 */
export const VIDEO_GENERATION_MODEL_REGISTRY_VERSION = '2026-08-10';

export const VIDEO_GENERATION_MODEL_REGISTRY: readonly VideoGenerationRegistryEntry[] = [
  {
    protocol: 'openai-compatible',
    modelId: 'sora-2',
    aliases: ['sora-2-pro', 'sora-2-turbo', 'openai/sora-2'],
    label: 'Sora 2',
    apiStyle: 'openai-videos',
    path: '/videos',
  },
  {
    protocol: 'openai-compatible',
    modelId: 'sora',
    aliases: ['openai/sora'],
    label: 'Sora',
    apiStyle: 'openai-videos',
    path: '/videos',
  },
  {
    protocol: 'google-gemini',
    modelId: 'veo-3.0-generate-001',
    aliases: [
      'veo-3',
      'veo-3.0',
      'veo-2.0-generate-001',
      'veo-2',
      'models/veo-3.0-generate-001',
      'models/veo-2.0-generate-001',
    ],
    label: 'Google Veo',
    apiStyle: 'google-veo',
    path: '/models/{model}:predictLongRunning',
  },
  {
    modelId: 'gen4-turbo',
    aliases: ['runway-gen4', 'gen4', 'gen3a_turbo', 'gen3-turbo'],
    label: 'Runway Gen',
    apiStyle: 'runway-tasks',
    path: '/v1/text_to_video',
  },
  {
    modelId: 'ray-2',
    aliases: ['ray-flash-2', 'luma-ray-2', 'dream-machine'],
    label: 'Luma Ray',
    apiStyle: 'luma-generations',
    path: '/dream-machine/v1/generations/video',
  },
  {
    modelId: 'MiniMax-Hailuo-02',
    aliases: ['minimax-video', 'hailuo-02', 'T2V-01', 'I2V-01'],
    label: 'MiniMax Hailuo',
    apiStyle: 'minimax-tasks',
    path: '/v2/video_generation',
  },
  {
    modelId: 'grok-imagine-video',
    aliases: ['grok-imagine-video-lite', 'grok-imagine-video-1.5-preview', 'grok-imagine-video-1.5'],
    prefix: true,
    label: 'Grok Imagine Video',
    apiStyle: 'xgrok-videos',
    path: '/videos/generations',
  },
];

export const IMAGE_GENERATION_MODEL_REGISTRY_VERSION = '2026-08-19';

/**
 * Known image-generation wire formats. Channel protocol is not the image
 * protocol: a mixed CPA can host OpenAI images, Gemini native, and Imagen.
 */
export const IMAGE_GENERATION_MODEL_REGISTRY: readonly ImageGenerationRegistryEntry[] = [
  {
    modelId: 'grok-imagine-image',
    aliases: [
      'grok-imagine-image-lite',
      'grok-imagine-image-quality',
      'grok-imagine-image-quality-lite',
    ],
    prefix: true,
    label: 'Grok Imagine Image',
    apiStyle: 'openai',
    path: '/images/generations',
  },
  {
    modelId: 'gpt-image-1',
    aliases: ['gpt-image-1.5', 'gpt-image-2', 'gpt-image'],
    prefix: true,
    label: 'GPT Image',
    apiStyle: 'openai',
    path: '/images/generations',
  },
  {
    modelId: 'dall-e-3',
    aliases: ['dall-e-2', 'dalle-3', 'dalle3', 'dall-e'],
    prefix: true,
    label: 'DALL·E',
    apiStyle: 'openai',
    path: '/images/generations',
  },
  {
    modelId: 'imagen-3.0-generate-002',
    aliases: ['imagen-4.0-generate-001', 'imagen-3', 'imagen-4', 'imagen'],
    prefix: true,
    label: 'Imagen',
    apiStyle: 'imagen',
  },
  {
    modelId: 'gemini-2.5-flash-image',
    aliases: [
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'gemini-3.0-pro-image',
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.5-flash-image-preview',
    ],
    label: 'Gemini Image',
    apiStyle: 'gemini',
  },
  {
    modelId: 'FLUX.1-schnell',
    aliases: ['flux.1-schnell', 'flux.1-dev', 'flux.1-pro', 'flux'],
    label: 'FLUX',
    apiStyle: 'openai',
    path: '/images/generations',
  },
  {
    modelId: 'Qwen-Image',
    aliases: ['qwen-image', 'qwen-image-plus'],
    prefix: true,
    label: 'Qwen Image',
    apiStyle: 'openai',
    path: '/images/generations',
  },
  {
    modelId: 'Kolors',
    aliases: ['kolors'],
    label: 'Kolors',
    apiStyle: 'openai',
    path: '/images/generations',
  },
];

/** Tokens that strongly suggest video *generation* (not understanding/vision). */
const VIDEO_GENERATION_HINT_PATTERN =
  /(?:^|[^a-z0-9])(?:sora|veo[-_]?\d*|runway|gen[-_]?[34]|ray[-_]?\d*|hailuo|seedance|luma|dream-?machine|text2video|txt2vid|t2v|i2v|video-?gen(?:eration)?|kling|pika|lumaai|grok-?imagine-video)(?:[^a-z0-9]|$)/i;

/** Tokens that indicate video understanding / vision rather than generation. */
const VIDEO_UNDERSTANDING_HINT_PATTERN =
  /(?:^|[^a-z0-9])(?:video-?(?:understand|understanding|analysis|analyze|caption|qa|chat|llm)|multimodal-?video|vision-?video)(?:[^a-z0-9]|$)/i;

export type VideoGenerationLookupResult = {
  entry: VideoGenerationRegistryEntry;
  matchedId: string;
  matchKind: 'exact' | 'alias' | 'prefix';
};

export type ImageGenerationLookupResult = {
  entry: ImageGenerationRegistryEntry;
  matchedId: string;
  matchKind: 'exact' | 'alias' | 'prefix';
};

type GenerationRegistryEntry = {
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  aliases?: readonly string[];
  prefix?: boolean;
};

function matchRegistryCandidate(
  modelId: string,
  candidate: string,
  entryModelId: string,
  allowPrefix: boolean,
): 'exact' | 'alias' | 'prefix' | undefined {
  const fullLower = modelId.toLowerCase();
  const splitLower = splitModelName(modelId).toLowerCase();
  const candidateLower = candidate.trim().toLowerCase();
  if (!candidateLower) return undefined;
  const candidateSplit = splitModelName(candidateLower).toLowerCase();
  if (
    fullLower === candidateLower ||
    splitLower === candidateLower ||
    fullLower === candidateSplit ||
    splitLower === candidateSplit
  ) {
    return candidateLower === entryModelId.toLowerCase() ? 'exact' : 'alias';
  }
  if (
    allowPrefix &&
    candidateLower.length >= 8 &&
    (fullLower.startsWith(`${candidateLower}-`) ||
      fullLower.startsWith(`${candidateLower}.`) ||
      splitLower.startsWith(`${candidateLower}-`) ||
      splitLower.startsWith(`${candidateLower}.`))
  ) {
    return 'prefix';
  }
  return undefined;
}

function lookupGenerationRegistry<T extends GenerationRegistryEntry>(
  registry: readonly T[],
  modelId: string,
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini',
): { entry: T; matchedId: string; matchKind: 'exact' | 'alias' | 'prefix' } | undefined {
  const trimmed = modelId.trim();
  if (!trimmed) return undefined;
  let loose:
    | { entry: T; matchedId: string; matchKind: 'exact' | 'alias' | 'prefix' }
    | undefined;
  for (const entry of registry) {
    const protocolMismatch = Boolean(entry.protocol && protocol && entry.protocol !== protocol);
    const candidates = [entry.modelId, ...(entry.aliases ?? [])];
    for (const candidate of candidates) {
      const kind = matchRegistryCandidate(
        trimmed,
        candidate,
        entry.modelId,
        entry.prefix === true,
      );
      if (!kind) continue;
      const hit = { entry, matchedId: trimmed, matchKind: kind };
      if (!protocolMismatch) return hit;
      loose ??= hit;
      break;
    }
  }
  return loose;
}

/**
 * Look up a curated video-generation registry entry by protocol + model id.
 * Matching is case-insensitive on full id, split name after `/`, and aliases.
 * A protocol filter prefers the same-channel row; mixed gateways still fall
 * back to the model-id match so Sora/Grok keep their working wire format.
 */
export function lookupVideoGenerationRegistry(
  modelId: string,
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini',
): VideoGenerationLookupResult | undefined {
  return lookupGenerationRegistry(VIDEO_GENERATION_MODEL_REGISTRY, modelId, protocol);
}

/** Look up the working image wire format by model id, not channel protocol. */
export function lookupImageGenerationRegistry(
  modelId: string,
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini',
): ImageGenerationLookupResult | undefined {
  return lookupGenerationRegistry(IMAGE_GENERATION_MODEL_REGISTRY, modelId, protocol);
}

/**
 * Heuristic: does this model look like a video-*generation* model?
 * Deliberately excludes bare "video" so vision/understanding models are not
 * silently tagged (ADR 0043).
 */
export function isLikelyVideoGenerationModel(
  modelId: string,
  label?: string,
  capabilities?: readonly string[],
): boolean {
  if (capabilities?.includes('video-generation')) {
    return true;
  }
  const haystack = `${modelId} ${label ?? ''}`.toLowerCase();
  if (VIDEO_UNDERSTANDING_HINT_PATTERN.test(haystack)) {
    return false;
  }
  return VIDEO_GENERATION_HINT_PATTERN.test(haystack);
}

const REALTIME_AUDIO_HINT_PATTERN = /\brealtime\b|grok-voice|speech-to-speech|voice-agent/i;
const REALTIME_AUDIO_EXCLUDE_PATTERN = /\b(whisper|grok-stt|speech-to-text|asr)\b/i;

/**
 * Heuristic: OpenAI-Realtime / speech-to-speech voice models.
 * ASR-only ids (whisper, grok-stt) stay out; chat audio-preview is not Live.
 */
export function isLikelyRealtimeAudioModel(
  modelId: string,
  label?: string,
  capabilities?: readonly string[],
): boolean {
  if (capabilities?.includes('realtime-audio')) {
    return true;
  }
  const haystack = `${modelId} ${label ?? ''}`.toLowerCase();
  if (REALTIME_AUDIO_EXCLUDE_PATTERN.test(haystack)) {
    return false;
  }
  return REALTIME_AUDIO_HINT_PATTERN.test(haystack);
}
