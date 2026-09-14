import { isModelEnabled } from '@piwin/contracts';
import type { ImageGenerationTestResult, ModelProviderConfig } from '@piwin/contracts';
import type { SecretResolver } from './secret-resolver.js';
import {
  callImageEndpoint,
  ImageGenConfigError,
  isImageGenerationModel,
  resolveImageCallAuth,
  type ResolveImageCallAuthOptions,
} from './image-gen-tool.js';

const DEFAULT_TEST_PROMPT =
  'A small solid red circle centered on a plain white background, minimal test image.';

export type ImageGenerationTestDependencies = {
  secretResolver: Pick<SecretResolver, 'resolveProviderSecret'>;
  /** One-shot credential supplied by Settings; never persisted. */
  apiKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
  piwinRoot?: string;
  loadSubscriptionMediaAuth?: ResolveImageCallAuthOptions['loadSubscriptionMediaAuth'];
};

/** Exercise the real image endpoint and discard bytes after validating the response. */
export async function testImageGenerationModel(
  provider: ModelProviderConfig,
  modelId: string,
  prompt: string | undefined,
  dependencies: ImageGenerationTestDependencies,
): Promise<ImageGenerationTestResult> {
  const normalizedModelId = modelId.trim();
  const model = provider.models.find(
    (candidate) =>
      candidate.id === normalizedModelId &&
      isModelEnabled(candidate) &&
      isImageGenerationModel(candidate),
  );
  if (!model) {
    throw new ImageGenConfigError(
      `Image generation test requires an enabled image model: ${normalizedModelId || '(empty)'}`,
    );
  }

  const { apiKey, subscriptionAuth } = await resolveImageCallAuth(provider, {
    secretResolver: dependencies.secretResolver,
    ...(dependencies.apiKey?.trim() ? { oneShotApiKey: dependencies.apiKey } : {}),
    ...(dependencies.piwinRoot !== undefined ? { piwinRoot: dependencies.piwinRoot } : {}),
    ...(dependencies.loadSubscriptionMediaAuth
      ? { loadSubscriptionMediaAuth: dependencies.loadSubscriptionMediaAuth }
      : {}),
  });
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const images = await callImageEndpoint(
    provider,
    model,
    { prompt: prompt?.trim() || DEFAULT_TEST_PROMPT, n: 1 },
    apiKey,
    undefined,
    dependencies.fetch,
    subscriptionAuth,
  );
  return {
    providerId: provider.id,
    modelId: model.id,
    durationMs: Math.max(0, now() - startedAt),
    imageCount: images.length,
    outputs: images.map((image) => ({
      mimeType: image.mimeType,
      byteSize: image.bytes.byteLength,
    })),
  };
}
