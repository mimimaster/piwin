/**
 * Host-owned Anthropic OAuth request shaping (from @gotgenes/pi-anthropic-auth).
 *
 * OAuth subscription providers skip product registerProvider and use Pi's
 * built-in `anthropic` catalog. Without a streamSimple wrapper, those
 * requests hit Anthropic as third-party and burn extra usage. Register a
 * thin streamSimple merge on `anthropic` so shaping always applies, whether
 * or not the bundled extension also loads.
 */
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { createAnthropicOAuthStreamSimple } from './oauth-transport.js';

export type AnthropicOauthShapingRuntime = {
  registerProvider: (providerId: string, config: Record<string, unknown>) => void;
};

/**
 * Merge Claude Code OAuth stream shaping onto Pi's built-in `anthropic` provider.
 * Safe to call after ModelRuntime.create / createAgentSession; merges with any
 * prior extension registration the same way Pi's registerProvider does.
 */
export function attachAnthropicOauthShaping(runtime: AnthropicOauthShapingRuntime): void {
  const transport = anthropicMessagesApi().streamSimple;
  if (typeof transport !== 'function') {
    throw new Error('Pi anthropicMessagesApi().streamSimple is unavailable');
  }
  const streamSimple = createAnthropicOAuthStreamSimple(transport);
  runtime.registerProvider('anthropic', {
    api: 'anthropic-messages',
    streamSimple,
  });
}
