import type { LiveDelegationContext, LiveDelegationDecision } from '@piwin/contracts';

export const LIVE_HOLD_EMPTY_REASON = 'live-delegation-held-empty';
export const LIVE_HOLD_MISMATCH_REASON = 'live-delegation-held-mismatch';

export function canonicalLiveBrief(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function resolveLiveWorkReuse(input: {
  kind: LiveDelegationDecision['kind'];
  brief?: string;
  tasks: readonly LiveDelegationContext[];
}): { action: 'reuse'; delegationId: string } | { action: 'admit' } {
  if (input.kind !== 'work') return { action: 'admit' };
  const brief = input.brief ? canonicalLiveBrief(input.brief) : '';
  if (!brief) return { action: 'admit' };
  const match = [...input.tasks].reverse().find(
    (task) => canonicalLiveBrief(task.brief) === brief,
  );
  if (!match) return { action: 'admit' };
  return { action: 'reuse', delegationId: match.delegationId };
}

export function liveHoldSpeakableReason(
  reason: string,
): 'hold-empty' | 'hold-mismatch' | null {
  if (reason === LIVE_HOLD_EMPTY_REASON) return 'hold-empty';
  if (reason === LIVE_HOLD_MISMATCH_REASON) return 'hold-mismatch';
  return null;
}
