/**
 * Maps product thinking levels to protocol-facing API values.
 *
 * `ultra` is product-only: it never leaves the host as an API effort string.
 */
import type { ModelRef, ThinkingLevel } from '@piwin/contracts';

export function mapThinkingLevelToApi(
  level: ThinkingLevel,
  protocol: ModelRef['protocol'] | undefined,
): string {
  if (level !== 'ultra') {
    return level;
  }
  if (protocol === 'anthropic-compatible') {
    return 'max';
  }
  // OpenAI-compatible and Google Gemini product Ultra both fall back to the
  // OpenAI-style API maximum used across compatible gateways.
  return 'xhigh';
}
