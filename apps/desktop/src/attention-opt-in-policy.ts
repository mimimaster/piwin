import type { AttentionAuthorization } from './desktop-attention-os';

export const ATTENTION_OPT_IN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldShowAttentionOptIn(input: {
  authorization: AttentionAuthorization;
  hasSentThisLaunch: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (input.authorization !== 'not-determined') {
    return false;
  }
  if (!input.hasSentThisLaunch) {
    return false;
  }
  if (input.dismissedAt === null) {
    return true;
  }
  return input.now - input.dismissedAt >= ATTENTION_OPT_IN_COOLDOWN_MS;
}
