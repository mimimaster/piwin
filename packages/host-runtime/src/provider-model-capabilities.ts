/**
 * Read explicit video-generation declarations from provider model metadata.
 *
 * Discovery must not retain the provider payload. This module returns only the
 * small normalized metadata needed by the Host's model suggestion contract.
 */
import type { ModelProviderConfig, VideoGenerationApiStyle } from '@piwin/contracts';

export type ExplicitVideoGenerationMetadata = {
  apiStyle?: VideoGenerationApiStyle;
  path?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export function readExplicitVideoGenerationMetadata(
  protocol: ModelProviderConfig['protocol'],
  rawModel: Record<string, unknown>,
): ExplicitVideoGenerationMetadata | undefined {
  const methods = readStringArray(rawModel.supportedGenerationMethods);
  if (
    protocol === 'google-gemini' &&
    methods.some((method) => method === 'predictLongRunning' || method === 'generateVideos')
  ) {
    return { apiStyle: 'google-veo' };
  }

  const capabilityRecord = asRecord(rawModel.capabilities);
  if (capabilityRecord?.video_generation === true || rawModel.video_generation === true) {
    return protocol === 'google-gemini' ? { apiStyle: 'google-veo' } : {};
  }

  const capabilityNames = readStringArray(rawModel.capabilities);
  if (capabilityNames.includes('video-generation')) {
    return protocol === 'google-gemini' ? { apiStyle: 'google-veo' } : {};
  }
  return undefined;
}
