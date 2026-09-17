import type { AttentionAuthorization } from './desktop-attention-os';

export function shouldShowAttentionOptIn(input: {
  authorization: AttentionAuthorization;
  hasSentThisLaunch: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean {
  void input;
  throw new Error('AN-U2 not implemented');
}
