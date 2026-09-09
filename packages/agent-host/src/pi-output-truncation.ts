/**
 * Gemini / OpenAI-compat gateways emit finish_reason max_tokens. Pi 0.84.2
 * only maps OpenAI `length` to a completed stop and treats the rest as error.
 * Normalize at the product boundary — do not fork Pi.
 */

const TRUNCATION_STOP_REASONS = new Set(['length', 'max_tokens']);
const FINISH_REASON_MAX_TOKENS = /finish_reason:\s*max_tokens/i;

export function isProviderOutputTruncation(
  stopReason: string,
  errorMessage?: string,
): boolean {
  const normalizedStopReason = stopReason.trim().toLowerCase();
  if (TRUNCATION_STOP_REASONS.has(normalizedStopReason)) {
    return true;
  }
  if (normalizedStopReason !== 'error' || errorMessage === undefined) {
    return false;
  }
  return FINISH_REASON_MAX_TOKENS.test(errorMessage);
}
