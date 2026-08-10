import { toMediaAttachmentRef, isModelEnabled } from '@piwin/contracts';
import type {
  HostToolRegistration,
  ModelCapability,
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRouteConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { createMediaService } from '@piwin/media';
import type { SecretResolver } from './secret-resolver.js';
import { findEnabledProvider, getEnabledProviders } from './provider-helpers.js';

export class ImageGenConfigError extends Error {
  readonly name = 'ImageGenConfigError';
}

export type ResolvedImageProvider = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

export type GeneratedImage = {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  revisedPrompt?: string;
};

export type ImageGenerationCallArgs = {
  prompt: string;
  editPath?: string;
  size?: string;
  quality?: string;
  n?: number;
};

const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;
export const MAX_IMAGES_PER_CALL = 4;

/** Capability tag is authoritative; a route-only entry remains valid for legacy configs. */
export function isImageGenerationModel(model: ModelConfigEntry): boolean {
  return (
    model.capabilities?.includes('image-generation') === true ||
    model.routes?.['image-generation'] !== undefined
  );
}

function enabledImageModels(provider: ModelProviderConfig): ModelConfigEntry[] {
  return provider.models.filter((model) => isModelEnabled(model) && isImageGenerationModel(model));
}

/** Resolve one enabled, image-capable provider/model without falling back to chat. */
export function resolveImageProvider(
  config: Pick<PiwinConfig, 'providers' | 'imageGeneration'>,
  modelId?: string,
  providerId?: string,
): ResolvedImageProvider {
  const providers = getEnabledProviders(config);
  const requestedModelId = modelId?.trim();
  const requestedProviderId = providerId?.trim();

  if (requestedProviderId) {
    const provider = findEnabledProvider(config, requestedProviderId);
    if (!provider) {
      throw new ImageGenConfigError(
        `image_gen: provider "${requestedProviderId}" is missing or disabled.`,
      );
    }
    const candidates = enabledImageModels(provider).filter(
      (model) => !requestedModelId || model.id === requestedModelId,
    );
    if (candidates.length === 1) {
      const model = candidates[0];
      if (model) return { provider, model };
    }
    if (candidates.length > 1) {
      throw new ImageGenConfigError(
        `image_gen: provider "${provider.id}" has multiple image models; pass a model id or set the image default.`,
      );
    }
    const modelPart = requestedModelId ? ` model "${requestedModelId}"` : ' an enabled image model';
    throw new ImageGenConfigError(
      `image_gen: provider "${provider.id}" does not expose${modelPart}.`,
    );
  }

  if (requestedModelId) {
    const matches = providers.flatMap((provider) =>
      enabledImageModels(provider)
        .filter((model) => model.id === requestedModelId)
        .map((model) => ({ provider, model })),
    );
    if (matches.length === 1) {
      const match = matches[0];
      if (match) return match;
    }
    if (matches.length > 1) {
      throw new ImageGenConfigError(
        `image_gen: image model "${requestedModelId}" exists on multiple providers; pass the provider id too.`,
      );
    }
    throw new ImageGenConfigError(
      `image_gen: no enabled image provider exposes model "${requestedModelId}". Add the image-generation capability under Settings → Image Generation.`,
    );
  }

  const configuredDefault = config.imageGeneration?.defaultModel;
  if (configuredDefault) {
    const provider = findEnabledProvider(config, configuredDefault.providerId);
    const model = provider?.models.find(
      (candidate) =>
        candidate.id === configuredDefault.modelId &&
        isModelEnabled(candidate) &&
        isImageGenerationModel(candidate),
    );
    if (provider && model) return { provider, model };
    throw new ImageGenConfigError(
      'image_gen: the default image model is missing, disabled, or not image-capable. Choose a new default under Settings → Image Generation.',
    );
  }

  const candidates = providers.flatMap((provider) =>
    enabledImageModels(provider).map((model) => ({ provider, model })),
  );
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (candidate) return candidate;
  }
  if (candidates.length > 1) {
    throw new ImageGenConfigError(
      'image_gen: multiple image models are configured. Choose a default under Settings → Image Generation.',
    );
  }
  throw new ImageGenConfigError(
    'image_gen: no image model configured. Add one under Settings → Image Generation.',
  );
}

/** Normalize a custom route path to a leading-slash relative path, rejecting host overrides. */
function normalizeCustomImagePath(routePath: string): string {
  if (/^https?:\/\//i.test(routePath)) {
    throw new ImageGenConfigError(
      'image_gen: image route "path" must be a relative path (e.g. "/images/generations"), not an absolute URL.',
    );
  }
  return routePath.startsWith('/') ? routePath : `/${routePath}`;
}

function resolveImagePath(
  provider: ModelProviderConfig,
  model: { id: string; routes?: Partial<Record<ModelCapability, ModelRouteConfig>> },
): string {
  const route = model.routes?.['image-generation'];
  if (route?.path?.trim()) {
    const base = provider.baseUrl.replace(/\/+$/, '');
    return `${base}${normalizeCustomImagePath(route.path.trim())}`;
  }
  if (provider.protocol === 'openai-compatible') {
    return `${provider.baseUrl.replace(/\/+$/, '')}/images/generations`;
  }
  if (provider.protocol === 'google-gemini') {
    return `${provider.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model.id)}:predict`;
  }
  throw new ImageGenConfigError(
    `image_gen: protocol "${provider.protocol}" does not support image generation.`,
  );
}

function resolveImageTimeout(model: {
  routes?: Partial<Record<ModelCapability, ModelRouteConfig>>;
}): number {
  const configured = model.routes?.['image-generation']?.timeoutMs;
  if (configured === undefined) return DEFAULT_IMAGE_TIMEOUT_MS;
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new ImageGenConfigError('image_gen: image route timeoutMs must be a positive integer');
  }
  return configured;
}

function resolveRequestedCount(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_IMAGES_PER_CALL) {
    throw new ImageGenConfigError(
      `image_gen: n must be an integer between 1 and ${MAX_IMAGES_PER_CALL}`,
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function providerRequestHeaders(
  provider: ModelProviderConfig,
  credentials: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(provider.headers ?? {})) {
    const normalized = name.toLowerCase();
    if (
      normalized !== 'authorization' &&
      normalized !== 'x-goog-api-key' &&
      normalized !== 'content-type'
    ) {
      headers[name] = value;
    }
  }
  return { ...headers, 'content-type': 'application/json', ...credentials };
}

function sniffGeneratedImageMimeType(bytes: Uint8Array): GeneratedImage['mimeType'] {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  throw new ImageGenConfigError(
    'image_gen: provider returned unsupported or invalid image bytes (expected PNG, JPEG, WebP, or GIF)',
  );
}

function generatedImage(bytes: Uint8Array, revisedPrompt?: string): GeneratedImage {
  const result: GeneratedImage = { bytes, mimeType: sniffGeneratedImageMimeType(bytes) };
  if (revisedPrompt) result.revisedPrompt = revisedPrompt;
  return result;
}

function decodeDataUrl(value: string): Uint8Array | null {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i.exec(value.trim());
  return match?.[1] ? base64ToBytes(match[1]) : null;
}

async function readProviderJson(response: Response, modelId: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ImageGenConfigError(`image_gen: provider returned invalid JSON (${modelId})`);
  }
}

function sanitizeProviderMessage(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|api)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function providerHttpError(
  response: Response,
  modelId: string,
): Promise<ImageGenConfigError> {
  let detail = '';
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = asRecord(JSON.parse(text));
        const nestedError = asRecord(parsed?.error);
        detail = optionalString(nestedError?.message) ?? optionalString(parsed?.message) ?? text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // The status and model still provide a stable boundary error.
  }
  const safeDetail = sanitizeProviderMessage(detail);
  return new ImageGenConfigError(
    `image_gen: provider returned HTTP ${response.status} (${modelId})${safeDetail ? `: ${safeDetail}` : ''}`,
  );
}

async function downloadGeneratedImage(
  urlValue: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  revisedPrompt?: string,
): Promise<GeneratedImage> {
  const inline = decodeDataUrl(urlValue);
  if (inline) return generatedImage(inline, revisedPrompt);

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new ImageGenConfigError('image_gen: provider returned an invalid image URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new ImageGenConfigError('image_gen: provider returned an unsafe image URL');
  }
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new ImageGenConfigError(
      `image_gen: failed to download generated image (HTTP ${response.status})`,
    );
  }
  return generatedImage(new Uint8Array(await response.arrayBuffer()), revisedPrompt);
}

async function parseOpenAiImages(
  payload: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<GeneratedImage[]> {
  const data = asRecord(payload)?.data;
  if (!Array.isArray(data)) {
    throw new ImageGenConfigError('image_gen: provider returned no image data');
  }
  const images: GeneratedImage[] = [];
  for (const rawItem of data) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const revisedPrompt = optionalString(item.revised_prompt);
    const base64 = optionalString(item.b64_json);
    if (base64) {
      const inline = decodeDataUrl(base64);
      images.push(generatedImage(inline ?? base64ToBytes(base64), revisedPrompt));
      continue;
    }
    const url = optionalString(item.url);
    if (url) {
      images.push(await downloadGeneratedImage(url, signal, fetchImpl, revisedPrompt));
    }
  }
  if (images.length === 0) {
    throw new ImageGenConfigError('image_gen: provider returned no image data');
  }
  return images;
}

function parseGoogleImages(payload: unknown): GeneratedImage[] {
  const predictions = asRecord(payload)?.predictions;
  if (!Array.isArray(predictions)) {
    throw new ImageGenConfigError('image_gen: provider returned no image data');
  }
  const images: GeneratedImage[] = [];
  for (const rawItem of predictions) {
    const item = asRecord(rawItem);
    const base64 = optionalString(item?.bytesBase64Encoded);
    if (base64) images.push(generatedImage(base64ToBytes(base64)));
  }
  if (images.length === 0) {
    throw new ImageGenConfigError('image_gen: provider returned no image data');
  }
  return images;
}

/** Call a provider image endpoint and normalize all returned raster images. */
export async function callImageEndpoint(
  provider: ModelProviderConfig,
  model: ModelConfigEntry,
  args: ImageGenerationCallArgs,
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<GeneratedImage[]> {
  const prompt = args.prompt.trim();
  if (!prompt) throw new ImageGenConfigError('image_gen: prompt is required');
  if (!isImageGenerationModel(model)) {
    throw new ImageGenConfigError(`image_gen: model "${model.id}" is not image-capable`);
  }

  const count = resolveRequestedCount(args.n);
  const endpoint = resolveImagePath(provider, model);
  const timeoutMs = resolveImageTimeout(model);
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  if (provider.protocol === 'openai-compatible') {
    if (args.editPath) {
      throw new ImageGenConfigError(
        'image_gen: image editing is not yet supported. Use generation (prompt-only) instead.',
      );
    }
    const body: Record<string, unknown> = { model: model.id, prompt, n: count };
    if (args.size?.trim()) body.size = args.size.trim();
    if (args.quality?.trim()) body.quality = args.quality.trim();
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: providerRequestHeaders(
        provider,
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      ),
      body: JSON.stringify(body),
      signal: requestSignal,
    });
    if (!response.ok) throw await providerHttpError(response, model.id);
    return parseOpenAiImages(await readProviderJson(response, model.id), requestSignal, fetchImpl);
  }

  if (provider.protocol === 'google-gemini') {
    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: count,
        ...(args.size?.trim() ? { aspectRatio: args.size.trim() } : {}),
      },
    };
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: providerRequestHeaders(provider, apiKey ? { 'x-goog-api-key': apiKey } : {}),
      body: JSON.stringify(body),
      signal: requestSignal,
    });
    if (!response.ok) throw await providerHttpError(response, model.id);
    return parseGoogleImages(await readProviderJson(response, model.id));
  }

  throw new ImageGenConfigError(
    `image_gen: protocol "${provider.protocol}" does not support image generation in piwin (supported: openai-compatible, google-gemini).`,
  );
}

export function base64ToBytes(base64Data: string): Uint8Array {
  const normalized = base64Data.replace(/\s/g, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new ImageGenConfigError('image_gen: provider returned invalid base64');
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

function isAllowedMimeType(allowedMimeTypes: readonly string[], mimeType: string): boolean {
  return allowedMimeTypes.some((allowed) => {
    const normalized = allowed.trim().toLowerCase();
    return (
      normalized === mimeType ||
      (normalized.endsWith('/*') && mimeType.startsWith(normalized.slice(0, -1)))
    );
  });
}

export type ImageGenToolOptions = {
  piwinRoot: string;
  sessionId: string;
  config: PiwinConfig;
  mediaConfig: { mediaRoot: string; maxPasteBytes: number; allowedMimeTypes: string[] };
  secretResolver: SecretResolver;
};

/** Build the image_gen host tool, or null when no unambiguous image model is configured. */
export function buildImageGenTool(options: ImageGenToolOptions): HostToolRegistration | null {
  const { config, sessionId, mediaConfig, secretResolver } = options;
  try {
    resolveImageProvider(config);
  } catch {
    return null;
  }

  return {
    descriptor: {
      name: 'image_gen',
      description:
        'Generate one or more raster images from a text prompt and return local media attachments. ' +
        'For photos, illustrations, icons, textures, mockups, and cutouts. ' +
        'Not for SVG/vector, icon-system edits, or HTML/CSS/canvas visuals.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'Detailed prompt describing subject, style, composition, lighting, and palette',
          },
          provider: {
            type: 'string',
            description: 'Optional configured provider id; useful when model ids overlap',
          },
          model: {
            type: 'string',
            description:
              'Optional configured image model id; defaults to the image-generation default',
          },
          size: {
            type: 'string',
            description: 'Optional size (OpenAI: 1024x1024; Gemini: aspect ratio such as 1:1)',
          },
          quality: { type: 'string', description: 'Optional provider quality preset' },
          n: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_IMAGES_PER_CALL,
            description: `Number of images, from 1 to ${MAX_IMAGES_PER_CALL} (default 1)`,
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    family: 'image-generation',
    permissionSpec: {
      action: 'network:image-gen',
      risk: 'network',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'network:image-gen' }),
    },
    async execute(args, signal) {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) {
        return { ok: false, code: 'invalid-input', message: 'prompt is required' };
      }
      const count = typeof args.n === 'number' ? args.n : undefined;
      if (
        count !== undefined &&
        (!Number.isSafeInteger(count) || count < 1 || count > MAX_IMAGES_PER_CALL)
      ) {
        return {
          ok: false,
          code: 'invalid-input',
          message: `n must be an integer between 1 and ${MAX_IMAGES_PER_CALL}`,
        };
      }

      const { provider, model } = resolveImageProvider(
        config,
        typeof args.model === 'string' ? args.model : undefined,
        typeof args.provider === 'string' ? args.provider : undefined,
      );
      const apiKey =
        provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()
          ? await secretResolver.resolveProviderSecret(provider)
          : '';
      const generated = await callImageEndpoint(
        provider,
        model,
        {
          prompt,
          ...(typeof args.size === 'string' ? { size: args.size } : {}),
          ...(typeof args.quality === 'string' ? { quality: args.quality } : {}),
          ...(count !== undefined ? { n: count } : {}),
        },
        apiKey,
        signal,
      );

      for (const image of generated) {
        if (!isAllowedMimeType(mediaConfig.allowedMimeTypes, image.mimeType)) {
          throw new ImageGenConfigError(
            `image_gen: provider returned ${image.mimeType}, but that type is not allowed by media.allowedMimeTypes`,
          );
        }
      }

      const media = createMediaService({
        mediaRoot: mediaConfig.mediaRoot,
        maxPasteBytes: mediaConfig.maxPasteBytes,
        allowedMimeTypes: mediaConfig.allowedMimeTypes,
      });
      const assets = [];
      for (const image of generated) {
        assets.push(
          await media.saveMediaAsset({
            sessionId,
            bytes: image.bytes,
            mimeType: image.mimeType,
            source: 'generated',
          }),
        );
      }
      const images = assets.map((asset, index) => ({
        path: asset.absolutePath,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        ...(generated[index]?.revisedPrompt
          ? { revisedPrompt: generated[index].revisedPrompt }
          : {}),
      }));
      const paths = assets.map((asset) => asset.absolutePath);
      const byteSize = assets.reduce((total, asset) => total + asset.byteSize, 0);
      const payload = {
        paths,
        images,
        imageCount: assets.length,
        mimeTypes: assets.map((asset) => asset.mimeType),
        byteSize,
      };
      return {
        ok: true,
        output: JSON.stringify(payload, null, 2),
        details: {
          ...payload,
          attachments: assets.map((asset) => toMediaAttachmentRef(asset, 'generated')),
        },
      };
    },
  };
}
