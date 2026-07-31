import type {
  ModelProviderConfig,
  PiwinConfig,
  PermissionDecision,
  PermissionRuleSet,
} from '@piwin/contracts';
import type { HostToolDefinition } from '@piwin/tools-web';
import { createMediaService } from '@piwin/media';
import type { SecretResolver } from './secret-resolver.js';
import type { ToolPermissionGate } from './session-tools.js';
import { resolveNonInteractiveDecision } from './permission-policy.js';
import { findMatchingRule } from './permission-rule-engine.js';

export class ImageGenConfigError extends Error {
  readonly name = 'ImageGenConfigError';
}

export type ResolvedImageProvider = {
  provider: ModelProviderConfig;
  /** The selected model entry (subtype of ModelConfigEntry, always has `.id`). */
  model: ModelProviderConfig['models'][number];
};

/** Resolve the provider + model for image generation by model name (or default). */
export function resolveImageProvider(
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>,
  modelId?: string,
): ResolvedImageProvider {
  const requested = modelId?.trim();
  const providers = config.providers ?? [];
  if (requested) {
    for (const provider of providers) {
      const match = (provider.models ?? []).find((m) => m.id === requested);
      if (match) return { provider, model: match };
    }
    throw new ImageGenConfigError(
      `image_gen: no configured provider exposes image model "${requested}". Add it under Settings → Providers.`,
    );
  }
  const defaultProvider = providers.find((p) => p.id === config.defaultProviderId);
  const defaultModel = defaultProvider?.models?.find((m) => m.id === config.defaultModelId);
  if (!defaultProvider || !defaultModel) {
    throw new ImageGenConfigError(
      'image_gen: no default image model configured. Enable image generation and add an image-capable model under Settings → Providers.',
    );
  }
  return { provider: defaultProvider, model: defaultModel };
}

const OPENAI_IMAGE_PROTOCOLS = new Set(['openai-compatible']);
const GEMINI_PROTOCOLS = new Set(['google-gemini']);

/** Call the provider's image endpoint and return raw image bytes. */
export async function callImageEndpoint(
  provider: ModelProviderConfig,
  model: { id: string },
  args: { prompt: string; editPath?: string; size?: string; quality?: string; n?: number },
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const prompt = args.prompt.trim();
  if (!prompt) throw new ImageGenConfigError('image_gen: prompt is required');

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (OPENAI_IMAGE_PROTOCOLS.has(provider.protocol)) {
    // Image editing (/images/edits) requires multipart image upload and is not
    // wired in this plan — fail loudly rather than send a malformed JSON body.
    if (args.editPath) {
      throw new ImageGenConfigError(
        'image_gen: image editing is not yet supported. Use generation (prompt-only) instead.',
      );
    }
    headers.authorization = `Bearer ${apiKey}`;
    const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/images/generations`;
    const body: Record<string, unknown> = { model: model.id, prompt, n: args.n ?? 1 };
    if (args.size) body.size = args.size;
    if (args.quality) body.quality = args.quality;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new ImageGenConfigError(
        `image_gen: provider returned HTTP ${response.status} (${model.id})`,
      );
    }
    const json = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = json.data?.[0];
    const b64 = item?.b64_json;
    if (b64) return base64ToBytes(b64);
    const url = item?.url;
    if (url) {
      const imageResp = await fetchImpl(url, signal ? { signal } : {});
      if (!imageResp.ok)
        throw new ImageGenConfigError(`image_gen: failed to download image from ${url}`);
      return new Uint8Array(await imageResp.arrayBuffer());
    }
    throw new ImageGenConfigError('image_gen: provider returned no image data');
  }

  if (GEMINI_PROTOCOLS.has(provider.protocol)) {
    const base = provider.baseUrl.replace(/\/+$/, '');
    const endpoint = `${base}/models/${model.id}:predict`;
    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: args.n ?? 1,
        ...(args.size ? { aspectRatio: args.size } : {}),
      },
    };
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { ...headers, 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new ImageGenConfigError(
        `image_gen: provider returned HTTP ${response.status} (${model.id})`,
      );
    }
    const json = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string }>;
    };
    const b64 = json.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new ImageGenConfigError('image_gen: provider returned no image data');
    return base64ToBytes(b64);
  }

  throw new ImageGenConfigError(
    `image_gen: protocol "${provider.protocol}" does not support image generation in piwin (supported: openai-compatible, google-gemini).`,
  );
}

export function base64ToBytes(base64Data: string): Uint8Array {
  const normalized = base64Data.replace(/\s/g, '');
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new ImageGenConfigError('image_gen: provider returned invalid base64');
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

export type ImageGenToolOptions = {
  piwinRoot: string;
  sessionId: string;
  config: PiwinConfig;
  mediaConfig: { mediaRoot: string; maxPasteBytes: number; allowedMimeTypes: string[] };
  secretResolver: SecretResolver;
  rules?: PermissionRuleSet;
  requestPermission?: ToolPermissionGate;
};

/** Evaluate permission for an image generation network call.
 * Reuses the web-fetch rule engine subject with the provider's base URL host.
 * Defaults to `ask` (paid API call); degrades to `deny` in non-interactive sessions. */
function evaluateImageGenPermission(
  providerBaseUrl: string,
  rules?: PermissionRuleSet,
): { decision: PermissionDecision; reason: string } {
  let host: string | undefined;
  try {
    host = new URL(providerBaseUrl).hostname.toLowerCase();
  } catch {
    host = undefined;
  }
  if (host && rules) {
    const matched = findMatchingRule({ kind: 'web-fetch', host }, rules);
    if (matched) {
      return { decision: matched.decision, reason: matched.reason };
    }
  }
  return { decision: 'ask', reason: host ? `image-gen:${host}` : 'image-gen' };
}

/** Build the image_gen host tool, or null when no image model is configured. */
export function buildImageGenTool(options: ImageGenToolOptions): HostToolDefinition | null {
  const { config, sessionId, mediaConfig, secretResolver } = options;
  try {
    resolveImageProvider(config);
  } catch {
    return null;
  }

  return {
    name: 'image_gen',
    description:
      'Generate a raster image from a text prompt using a configured image model. ' +
      'Returns the absolute path(s) to saved images under the media store. ' +
      'Use for photos, illustrations, icons, textures, mockups, or transparent cutouts. ' +
      'Do not use for SVG/vector/code-native assets or HTML/CSS/canvas visuals.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed prompt describing the image to generate' },
        model: {
          type: 'string',
          description:
            'Optional image model id (routed by name). Defaults to the configured default model.',
        },
        size: {
          type: 'string',
          description: 'Optional size (openai: e.g. 1024x1024; gemini: aspect ratio e.g. 1:1)',
        },
        quality: { type: 'string', description: 'Optional quality (openai only)' },
        n: { type: 'number', description: 'Optional number of images (default 1)' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async execute(args, signal) {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) return JSON.stringify({ error: 'prompt is required' }, null, 2);

      const { provider, model } = resolveImageProvider(
        config,
        typeof args.model === 'string' ? args.model : undefined,
      );

      // Permission gate — image gen is a paid network call, default ask.
      const evaluation = evaluateImageGenPermission(provider.baseUrl, options.rules);
      let decision: PermissionDecision = evaluation.decision;
      if (decision === 'ask') {
        if (options.requestPermission) {
          decision = await options.requestPermission({
            action: 'network:image-gen',
            detail: prompt.slice(0, 160),
            defaultDecision: 'ask',
            ...(signal ? { signal } : {}),
          });
        } else {
          decision = resolveNonInteractiveDecision(evaluation);
        }
      }
      if (decision !== 'allow') {
        return JSON.stringify(
          { error: `image_gen permission ${decision}: ${evaluation.reason}` },
          null,
          2,
        );
      }

      const apiKey = await secretResolver.resolveProviderSecret(provider);
      const bytes = await callImageEndpoint(
        provider,
        model,
        {
          prompt,
          ...(typeof args.size === 'string' ? { size: args.size } : {}),
          ...(typeof args.quality === 'string' ? { quality: args.quality } : {}),
          ...(typeof args.n === 'number' && Number.isFinite(args.n)
            ? { n: Math.max(1, Math.floor(args.n)) }
            : {}),
        },
        apiKey,
        signal,
      );

      const media = createMediaService({
        mediaRoot: mediaConfig.mediaRoot,
        maxPasteBytes: mediaConfig.maxPasteBytes,
        allowedMimeTypes: mediaConfig.allowedMimeTypes,
      });
      const asset = await media.saveMediaAsset({
        sessionId,
        bytes,
        mimeType: 'image/png',
        source: 'generated',
      });
      return JSON.stringify(
        { paths: [asset.absolutePath], mimeType: asset.mimeType, byteSize: asset.byteSize },
        null,
        2,
      );
    },
  };
}
