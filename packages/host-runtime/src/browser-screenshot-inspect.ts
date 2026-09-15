/**
 * Persist a browser screenshot under the media root and close the visual QA
 * loop: vision primaries get native JPEG parts; text-only primaries get a
 * vision-delegation description. UI always reads `details.attachments`.
 */

import { formatError, toMediaAttachmentRef } from '@piwin/contracts';
import type {
  BrowserScreenshotEvidence,
  MediaAttachmentRef,
  PiwinConfig,
  ToolResultImage,
} from '@piwin/contracts';
import { createMediaService, createModelImageDerivative } from '@piwin/media';
import type { ModelImageDerivative } from '@piwin/media';
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
  /** Test seam; production derives through `@piwin/media`. */
  deriveModelImage?: (input: {
    bytes: Uint8Array;
    maxBytes: number;
  }) => Promise<ModelImageDerivative | undefined>;
};

export type ScreenshotDerivativeInfo = {
  maxEdge: number;
  quality: number;
  width: number;
  height: number;
  sourceBytes: number;
};

export type ScreenshotInspectReport =
  | {
      status: 'native';
      /** Present when the native image is a bounded derivative, not the original. */
      derivative?: ScreenshotDerivativeInfo;
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

export type PersistBrowserScreenshotResult = {
  output: {
    status: 'success';
    width: number;
    height: number;
    mediaId: string;
    mimeType: string;
    inspect: ScreenshotInspectReport;
    evidence: BrowserScreenshotEvidence;
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
  const native = await resolveNativeImages(input);
  const inspect: ScreenshotInspectReport = native
    ? { status: 'native', ...(native.derivative ? { derivative: native.derivative } : {}) }
    : await describeScreenshotIfConfigured(input, asset.absolutePath);
  const evidence = screenshotEvidence(inspect, asset.id);
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
    ...(native ? { images: native.images } : {}),
  };
}

type NativeImageSelection = {
  images: ToolResultImage[];
  derivative?: ScreenshotDerivativeInfo;
};

function toToolResultImage(bytes: Uint8Array): ToolResultImage {
  return { mimeType: JPEG_MIME, dataBase64: Buffer.from(bytes).toString('base64') };
}

/**
 * Vision primaries get the original when it fits. An oversized capture is
 * downscaled into a bounded derivative instead of silently dropping pixels —
 * dropping them made the model report a capture it never saw (spec §7).
 */
async function resolveNativeImages(
  input: PersistBrowserScreenshotInput,
): Promise<NativeImageSelection | undefined> {
  if (!input.primarySupportsImage) return undefined;
  if (input.jpegBytes.byteLength === 0) return undefined;
  if (input.jpegBytes.byteLength <= MAX_NATIVE_SCREENSHOT_BYTES) {
    return { images: [toToolResultImage(input.jpegBytes)] };
  }
  const derive = input.deriveModelImage ?? createModelImageDerivative;
  let derivative: ModelImageDerivative | undefined;
  try {
    derivative = await derive({ bytes: input.jpegBytes, maxBytes: MAX_NATIVE_SCREENSHOT_BYTES });
  } catch {
    derivative = undefined;
  }
  if (derivative === undefined) return undefined;
  return {
    images: [toToolResultImage(derivative.bytes)],
    derivative: {
      maxEdge: derivative.maxEdge,
      quality: derivative.quality,
      width: derivative.width,
      height: derivative.height,
      sourceBytes: input.jpegBytes.byteLength,
    },
  };
}

/**
 * Spec §7: only delivered/delegated count as model-visible pixels. Delegation
 * and derivative failures keep the capture successful but report the reason.
 */
function screenshotEvidence(
  inspect: ScreenshotInspectReport,
  mediaId: string,
): BrowserScreenshotEvidence {
  if (inspect.status === 'native') return { status: 'delivered', mediaId };
  if (inspect.status === 'ok') {
    return {
      status: 'delegated',
      mediaId,
      description: inspect.description,
      model: `${inspect.model.providerId}/${inspect.model.modelId}`,
    };
  }
  return { status: 'unavailable', mediaId, reason: inspect.reason };
}

function nativeNotice(inspect: ScreenshotInspectReport): string {
  if (inspect.status === 'native') {
    if (inspect.derivative) {
      return `The original capture exceeded the native image budget (${inspect.derivative.sourceBytes} bytes) and a downscaled derivative is attached. Inspect those pixels; the full-resolution capture stays in the media library. Do not embed markdown images or local file paths.`;
    }
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
