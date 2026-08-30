import type { ModelRef, PiwinConfig } from '@piwin/contracts';

/**
 * Rewrite every persisted channel ModelRef from one provider id to another.
 * Keep CHANNEL_MODEL_REF_WRITER_PATHS exhaustive — tests fail when a new
 * ModelRef field is added without a rewriter case.
 */
export function rewriteChannelModelRefs(
  config: PiwinConfig,
  fromProviderId: string,
  toProviderId: string,
): PiwinConfig {
  const rewritten = rewriteValue(config, fromProviderId, toProviderId) as PiwinConfig;
  if (rewritten.defaultProviderId === fromProviderId) {
    return { ...rewritten, defaultProviderId: toProviderId };
  }
  return rewritten;
}

function rewriteValue(value: unknown, fromProviderId: string, toProviderId: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteValue(entry, fromProviderId, toProviderId));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (isChannelModelRef(value) && value.providerId === fromProviderId) {
    return { ...value, providerId: toProviderId, source: 'channel' };
  }
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    next[key] = rewriteValue(child, fromProviderId, toProviderId);
  }
  return next;
}

function isChannelModelRef(value: object): value is ModelRef {
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerId === 'string' &&
    typeof record.modelId === 'string' &&
    record.source !== 'subscription'
  );
}

/** Fields this rewriter covers — keep aligned with rewriteChannelModelRefs. */
export const CHANNEL_MODEL_REF_WRITER_PATHS = [
  'defaultProviderId',
  'desktop.composerProfile.model',
  'visionDelegation.model',
  'replyWriter.model',
  'imageGeneration.defaultModel',
  'videoGeneration.defaultModel',
  'speech.asr.defaultModel',
  'speech.tts.defaultModel',
  'web.searchDelegateModel',
  'web.fetchDelegateModel',
  'walkthrough.custom.model',
  'subagents.profiles[].model',
  'subagents.schemes[].members[].model',
] as const;
