/**
 * Carry a paused run's per-send turn choices into its resume.
 *
 * Scheme and delegation policy are chosen per send and bound per run. A resume
 * is a new run, so without this it silently fell back to freehand: Fusion
 * sidekicks lost their pinned model and Lead-review authority, and a
 * `disabled` delegation turned back into `auto`.
 */
import type { PromptInput, SessionPauseTurnPolicy } from '@piwin/contracts';
import type { SessionLiveContext } from './session-live-context.js';

/**
 * What the send asked for, recorded at admission — before preparation binds
 * the resolved scheme, so a pause during preparation still sees it. The id was
 * already validated by admission; conversations never carry a scheme.
 */
export function requestedTurnPolicy(
  input: Pick<PromptInput, 'orchestrationSchemeId' | 'delegationMode'>,
  conversationChat: boolean,
): SessionPauseTurnPolicy | undefined {
  const schemeId = conversationChat ? undefined : input.orchestrationSchemeId?.trim();
  const policy: SessionPauseTurnPolicy = {
    ...(schemeId && schemeId !== 'off' ? { orchestrationSchemeId: schemeId } : {}),
    ...(conversationChat || input.delegationMode === 'disabled'
      ? { delegationMode: 'disabled' as const }
      : {}),
  };
  return Object.keys(policy).length > 0 ? policy : undefined;
}

export function capturePausedTurnPolicy(
  context: Pick<SessionLiveContext, 'getRunTurnPolicy'>,
  runId: string,
): SessionPauseTurnPolicy | undefined {
  const policy = context.getRunTurnPolicy?.(runId);
  return policy ? { ...policy } : undefined;
}

export function resumeTurnPolicyInput(
  policy: SessionPauseTurnPolicy | undefined,
): Pick<PromptInput, 'orchestrationSchemeId' | 'delegationMode'> {
  if (!policy) return {};
  return {
    ...(policy.orchestrationSchemeId ? { orchestrationSchemeId: policy.orchestrationSchemeId } : {}),
    ...(policy.delegationMode ? { delegationMode: policy.delegationMode } : {}),
  };
}
