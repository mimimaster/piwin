/**
 * Persist a browser screenshot under the media root and close the visual QA
 * loop: vision primaries get native JPEG parts; text-only primaries get a
 * vision-delegation description. UI always reads `details.attachments`.
 */

import { formatError, toMediaAttachmentRef } from '@piwin/contracts';
import type { MediaAttachmentRef, PiwinConfig, ToolResultImage } from '@piwin/contracts';
import { createMediaService } from '@piwin/media';
import { findEnabledProvider } from './provider-helpers.js';
import type { SecretResolver } from './secret-resolver.js';
import {
  delegateImageToVisionModel,
  sharedVisionDelegationCache,
  VisionDelegationCache,
} from './vision-delegation.js';

export const BROWSER_SCREENSHOT_INSPECT_PROMPT =
  'You are inspecting a browser screenshot for a coding agent doing visual QA. Report the page purpose, visible text, layout, controls, errors, and anything that looks broken. Quote on-screen text. Be concise.';

const JPEG_MIME = 'image/jpeg';
const DEFAULT_MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export type ScreenshotInspectConfig = Pick<PiwinConfig, 'providers'> &
  Partial<Pick<PiwinConfig, 'visionDelegation'>>;

export type PersistBrowserScreenshotInput = {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
  sessionId: string;
  mediaRoot: string;
  /** When true, attach native pixels so a vision primary can see the page. */
  primarySupportsImage?: boolean;
  config?: ScreenshotInspectConfig;
  secretResolver?: SecretResolver;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type ScreenshotInspectReport =
  | {
      status: 'native';
    }
  | {
      status: 'ok';
      description: string;
      model: { providerId: string; modelId: string };
      cacheHit: boolean;
    }
  | {
      status: 'skipped';
      reason: string;
    };

export type ScreenshotEvidence = 'delivered' | 'delegated' | 'unavailable';

export type PersistBrowserScreenshotResult = {
  output: {
    status: 'success';
    width: number;
    height: number;
    mediaId: string;
    mimeType: string;
    inspect: ScreenshotInspectReport;
    evidence: ScreenshotEvidence;
    notice: string;
  };
  details: {
    width: number;
    height: number;
    attachments: MediaAttachmentRef[];
  };
  images?: ToolResultImage[];
};

const MAX_NATIVE_SCREENSHOT_BYTES = 1_500_000;

/** Decode a `data:image/jpeg;base64,...` URL. Returns undefined when malformed. */
export function jpegBytesFromDataUrl(dataUrl: string): Uint8Array | undefined {
  const trimmed = dataUrl.trim();
  const comma = trimmed.indexOf(',');
  if (comma <= 0) return undefined;
  const header = trimmed.slice(0, comma).toLowerCase();
  if (!header.startsWith('data:image/') || !header.includes(';base64')) {
    return undefined;
  }
  try {
    const bytes = Buffer.from(trimmed.slice(comma + 1), 'base64');
    return bytes.byteLength > 0 ? new Uint8Array(bytes) : undefined;
  } catch {
    return undefined;
  }
}

export async function persistAndInspectBrowserScreenshot(
  input: PersistBrowserScreenshotInput,
): Promise<PersistBrowserScreenshotResult> {
  const media = createMediaService({
    mediaRoot: input.mediaRoot,
    maxPasteBytes: DEFAULT_MAX_SCREENSHOT_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  const asset = await media.saveMediaAsset({
    sessionId: input.sessionId,
    bytes: input.jpegBytes,
    mimeType: JPEG_MIME,
    name: 'browser-screenshot.jpg',
    source: 'generated',
  });
  const attachment = toMediaAttachmentRef(
    {
      ...asset,
      width: input.width,
      height: input.height,
    },
    'generated',
  );
  const images = nativeToolResultImages(input);
  const inspect = images
    ? ({ status: 'native' } as const)
    : await describeScreenshotIfConfigured(input, asset.absolutePath);
  const evidence: ScreenshotEvidence =
    inspect.status === 'native' ? 'delivered' : inspect.status === 'ok' ? 'delegated' : 'unavailable';
  return {
    output: {
      status: 'success',
      width: input.width,
      height: input.height,
      mediaId: asset.id,
      mimeType: JPEG_MIME,
      inspect,
      evidence,
      notice: nativeNotice(inspect),
    },
    details: {
      width: input.width,
      height: input.height,
      attachments: [attachment],
    },
    ...(images ? { images } : {}),
  };
}

function nativeToolResultImages(
  input: PersistBrowserScreenshotInput,
): ToolResultImage[] | undefined {
  if (!input.primarySupportsImage) return undefined;
  if (input.jpegBytes.byteLength === 0 || input.jpegBytes.byteLength > MAX_NATIVE_SCREENSHOT_BYTES) {
    return undefined;
  }
  return [
    {
      mimeType: JPEG_MIME,
      dataBase64: Buffer.from(input.jpegBytes).toString('base64'),
    },
  ];
}

function nativeNotice(inspect: ScreenshotInspectReport): string {
  if (inspect.status === 'native') {
    return 'A screenshot image is attached to this tool result. Inspect the pixels and continue fixing. Do not embed markdown images or local file paths.';
  }
  if (inspect.status === 'ok') {
    return 'The client UI rendered this screenshot. A vision model described it because the primary model cannot see images.';
  }
  return 'The client UI rendered this screenshot. The primary model cannot see pixels and vision delegation was not used. Switch to a vision model or enable vision delegation.';
}

async function describeScreenshotIfConfigured(
  input: PersistBrowserScreenshotInput,
  imagePath: string,
): Promise<ScreenshotInspectReport> {
  const config = input.config;
  const vision = config?.visionDelegation;
  if (!config || !vision?.enabled || !vision.model) {
    return { status: 'skipped', reason: 'vision-delegation-disabled' };
  }
  if (!input.secretResolver) {
    return { status: 'skipped', reason: 'no-secret-resolver' };
  }
  const provider = findEnabledProvider(config, vision.model.providerId);
  if (!provider) {
    return { status: 'skipped', reason: 'vision-provider-missing' };
  }

  let apiKey: string;
  try {
    apiKey = await input.secretResolver.resolveProviderSecret(provider);
  } catch (error) {
    return { status: 'skipped', reason: `vision-secret: ${formatError(error)}` };
  }
  if (!apiKey.trim()) {
    return { status: 'skipped', reason: 'vision-secret-empty' };
  }

  const systemPrompt = BROWSER_SCREENSHOT_INSPECT_PROMPT;
  const cacheKey =
    vision.cacheEnabled === false
      ? null
      : VisionDelegationCache.buildKey({
          fileBytes: input.jpegBytes,
          mimeType: JPEG_MIME,
          providerId: vision.model.providerId,
          modelId: vision.model.modelId,
          systemPrompt,
        });
  if (cacheKey) {
    const cached = sharedVisionDelegationCache.get(cacheKey);
    if (cached !== undefined) {
      return {
        status: 'ok',
        description: cached,
        model: { providerId: vision.model.providerId, modelId: vision.model.modelId },
        cacheHit: true,
      };
    }
  }

  try {
    const description = await delegateImageToVisionModel({
      imagePath,
      mimeType: JPEG_MIME,
      provider,
      modelId: vision.model.modelId,
      apiKey,
      systemPrompt,
      ...(vision.timeoutMs !== undefined ? { timeoutMs: vision.timeoutMs } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    if (cacheKey) {
      sharedVisionDelegationCache.set(cacheKey, description);
    }
    return {
      status: 'ok',
      description,
      model: { providerId: vision.model.providerId, modelId: vision.model.modelId },
      cacheHit: false,
    };
  } catch (error) {
    return { status: 'skipped', reason: `vision-describe-failed: ${formatError(error)}` };
  }
}
