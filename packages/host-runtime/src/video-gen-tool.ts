import { readFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { toMediaAttachmentRef } from '@piwin/contracts';
import type {
  HostToolRegistration,
  ModelConfigEntry,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import {
  createMediaService,
  assertInsideMediaRoot,
  assertRealPathInsideMediaRoot,
  writeMediaLibraryMeta,
} from '@piwin/media';
import { isModelEnabled } from '@piwin/contracts';
import { loadSubscriptionMediaAuth, providerUsesSubscriptionMedia } from './subscription-media-request.js';
import type { SecretResolver } from './secret-resolver.js';
import { findEnabledProvider, getEnabledProviders } from './provider-helpers.js';
import { callVideoEndpoint } from './video-generation-adapters.js';
import { VideoGenConfigError, type VideoGenerationImageInput } from './video-generation-types.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

export type ResolvedVideoProvider = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

/** Resolve a configured video-capable provider and model. */
export function resolveVideoProvider(
  config: Pick<
    PiwinConfig,
    'providers' | 'defaultProviderId' | 'defaultModelId' | 'videoGeneration'
  >,
  modelId?: string,
): ResolvedVideoProvider {
  const providers = getEnabledProviders(config);
  const requested = modelId?.trim();

  if (requested) {
    for (const provider of providers) {
      const model = provider.models.find(
        (candidate) =>
          candidate.id === requested && isModelEnabled(candidate) && isVideoModel(candidate),
      );
      if (model) return { provider, model };
    }
    throw new VideoGenConfigError(
      `video_gen: no configured provider exposes video model "${requested}". Add it under Settings → Image Generation → Video Generation.`,
    );
  }

  const configuredDefault = config.videoGeneration?.defaultModel;
  if (configuredDefault) {
    const provider = findEnabledProvider(config, configuredDefault.providerId);
    const model = provider?.models.find(
      (candidate) =>
        candidate.id === configuredDefault.modelId &&
        isModelEnabled(candidate) &&
        isVideoModel(candidate),
    );
    if (provider && model) return { provider, model };
  }

  if (config.defaultProviderId && config.defaultModelId) {
    const provider = findEnabledProvider(config, config.defaultProviderId);
    const model = provider?.models.find(
      (candidate) =>
        candidate.id === config.defaultModelId &&
        isModelEnabled(candidate) &&
        isVideoModel(candidate),
    );
    if (provider && model) return { provider, model };
  }

  for (const provider of providers) {
    const model = provider.models.find(
      (candidate) => isModelEnabled(candidate) && isVideoModel(candidate),
    );
    if (model) return { provider, model };
  }

  throw new VideoGenConfigError(
    'video_gen: no video model configured. Add a video-capable model under Settings → Image Generation → Video Generation.',
  );
}

export function isVideoModel(model: ModelConfigEntry): boolean {
  return (
    model.capabilities?.includes('video-generation') === true ||
    model.routes?.['video-generation'] !== undefined
  );
}

export type VideoGenToolOptions = {
  piwinRoot: string;
  sessionId: string;
  config: PiwinConfig;
  mediaConfig: { mediaRoot: string; maxPasteBytes: number; allowedMimeTypes: string[] };
  secretResolver: SecretResolver;
};

/** Build the video_gen Host tool, or null when no video model is configured. */
export function buildVideoGenTool(options: VideoGenToolOptions): HostToolRegistration | null {
  const { config, sessionId, mediaConfig, secretResolver } = options;
  try {
    resolveVideoProvider(config);
  } catch {
    return null;
  }

  return {
    descriptor: {
      name: 'video_gen',
      description:
        'Generate short video clips from text prompts or reference images (inputImagePath). ' +
        'Describe subject motion, camera trajectory (pan/zoom), and lighting. ' +
        'Never output markdown video tags or local filesystem paths in text.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the scene, motion, camera, timing, and style',
          },
          model: {
            type: 'string',
            description:
              'Optional configured video model id; defaults to the video-generation default',
          },
          durationSeconds: {
            type: 'number',
            description:
              'Optional duration in seconds; the provider adapter normalizes supported values',
          },
          aspectRatio: {
            type: 'string',
            description: 'Optional aspect ratio such as 16:9, 9:16, or 1:1',
          },
          size: {
            type: 'string',
            description: 'Optional provider size such as 1280x720 (OpenAI Videos)',
          },
          resolution: {
            type: 'string',
            description: 'Optional provider resolution such as 768P, 2K, or 1080p',
          },
          inputImagePath: {
            type: 'string',
            description:
              'Optional absolute path to an image already inside ~/.piwin/media; it is sent as the provider-native image reference',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    family: 'video-generation',
    permissionSpec: {
      action: 'network:video-gen',
      risk: 'network',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'network:video-gen' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args, signal) {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) {
        return { ok: false, code: 'invalid-input', message: 'prompt is required' };
      }

      const { provider, model } = resolveVideoProvider(
        config,
        typeof args.model === 'string' ? args.model : undefined,
      );
      const inputImage =
        typeof args.inputImagePath === 'string' && args.inputImagePath.trim()
          ? await loadVideoReferenceImage(
              args.inputImagePath,
              mediaConfig.mediaRoot,
              mediaConfig.maxPasteBytes,
            )
          : undefined;
      const apiKey = providerUsesSubscriptionMedia(provider, 'video')
        ? (
            await loadSubscriptionMediaAuth(provider.id).catch((error: unknown) => {
              throw new VideoGenConfigError(
                error instanceof Error ? error.message : `video_gen: ${String(error)}`,
              );
            })
          ).accessToken
        : await secretResolver.resolveProviderSecret(provider);
      const durationSeconds = readFiniteNumber(args.durationSeconds);
      const aspectRatio = readStringArgument(args.aspectRatio);
      const size = readStringArgument(args.size);
      const resolution = readStringArgument(args.resolution);
      const generated = await callVideoEndpoint({
        provider,
        model,
        apiKey,
        input: {
          prompt,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          ...(aspectRatio !== undefined ? { aspectRatio } : {}),
          ...(size !== undefined ? { size } : {}),
          ...(resolution !== undefined ? { resolution } : {}),
          ...(inputImage ? { inputImage } : {}),
        },
        signal,
      });

      const media = createMediaService({
        mediaRoot: mediaConfig.mediaRoot,
        maxPasteBytes: mediaConfig.maxPasteBytes,
        allowedMimeTypes: [...mediaConfig.allowedMimeTypes, generated.mimeType],
      });
      const asset = await media.saveMediaAsset({
        sessionId,
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        source: 'generated',
      });
      await writeMediaLibraryMeta(
        { mediaRoot: mediaConfig.mediaRoot },
        sessionId,
        asset.id,
        {
          source: 'generated',
          kind: 'video',
          createdAt: asset.createdAt,
          prompt,
          model: model.id,
        },
      );
      return {
        ok: true,
        output: JSON.stringify(
          {
            status: 'success',
            videoCount: 1,
            mediaIds: [asset.id],
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            ...(generated.providerTaskId ? { providerTaskId: generated.providerTaskId } : {}),
            notice:
              'The client UI already rendered this video as an attachment. Do not embed markdown videos or local file paths in your reply.',
          },
          null,
          2,
        ),
        details: {
          paths: [asset.absolutePath],
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          providerTaskId: generated.providerTaskId,
          attachments: [toMediaAttachmentRef(asset, 'generated')],
        },
      };
    },
  };
}

async function loadVideoReferenceImage(
  inputPath: string,
  mediaRoot: string,
  maxBytes: number,
): Promise<VideoGenerationImageInput> {
  const absolutePath = assertInsideMediaRoot(mediaRoot, inputPath);
  await assertRealPathInsideMediaRoot(mediaRoot, absolutePath);
  const bytes = new Uint8Array(await readFile(absolutePath));
  if (bytes.byteLength === 0) throw new VideoGenConfigError('video_gen: input image is empty');
  if (bytes.byteLength > maxBytes) {
    throw new VideoGenConfigError(
      `video_gen: input image is too large: ${bytes.byteLength} > max ${maxBytes}`,
    );
  }
  const mimeType = imageMimeFromPath(absolutePath);
  return { bytes, mimeType, fileName: basename(absolutePath) };
}

function imageMimeFromPath(pathValue: string): VideoGenerationImageInput['mimeType'] {
  switch (extname(pathValue).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      throw new VideoGenConfigError(
        'video_gen: inputImagePath must point to a PNG, JPEG, or WebP image in the media store',
      );
  }
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArgument(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
