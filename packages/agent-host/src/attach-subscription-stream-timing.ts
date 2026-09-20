/**
 * OAuth subscription providers skip product registerProvider and use Pi
 * builtins, so the channel streamSimple timing wrap never runs. Overlay a
 * timing-only streamSimple (no models/auth) so firstTokenMs is stamped on
 * the LLM stream instead of the batched session-event fallback.
 *
 * Pi only applies extension.streamSimple when `model.api === extension.api`,
 * so each overlay covers one API. grok-4.6 is openai-completions; Codex is
 * openai-codex-responses. Responses-only Grok variants still use the
 * session-event fallback.
 */
import { CLAUDE_CODE_OAUTH_PROVIDER_ID } from '@piwin/contracts';
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
import type { PiModelRuntime } from './pi-model-runtime.js';
import {
  adaptPiApiStreamSimple,
  resolvePiNativeSearchStream,
} from './pi-native-search-stream.js';
import { wrapStreamSimpleForRequestTiming } from './stream-request-timing.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

export type SubscriptionStreamTimingOverlay = {
  api: string;
  streamSimple: NativeSearchStreamSimple;
};

const SUBSCRIPTION_STREAM_TIMING_API: Record<string, string> = {
  xai: 'openai-completions',
  'openai-codex': 'openai-codex-responses',
  anthropic: 'anthropic-messages',
  'kimi-coding': 'anthropic-messages',
  'github-copilot': 'openai-completions',
};

export function resolveSubscriptionStreamTimingOverlay(
  providerId: string,
): SubscriptionStreamTimingOverlay | undefined {
  if (providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID) {
    return undefined;
  }
  const api = SUBSCRIPTION_STREAM_TIMING_API[providerId];
  if (!api) {
    return undefined;
  }
  const base =
    api === 'openai-codex-responses'
      ? adaptPiApiStreamSimple(openAICodexResponsesApi().streamSimple)
      : api === 'openai-completions' || api === 'anthropic-messages'
        ? resolvePiNativeSearchStream(api)
        : undefined;
  const streamSimple = wrapStreamSimpleForRequestTiming(base);
  if (!streamSimple) {
    return undefined;
  }
  return { api, streamSimple };
}

/** Merge timing-only streamSimple onto Pi builtin OAuth providers. */
export function attachSubscriptionStreamTiming(
  runtime: Pick<PiModelRuntime, 'registerProvider'>,
  providerIds: readonly string[],
): void {
  for (const providerId of providerIds) {
    const overlay = resolveSubscriptionStreamTimingOverlay(providerId);
    if (!overlay) {
      continue;
    }
    runtime.registerProvider(providerId, overlay as never);
  }
}
