import {
  type ResolvedOrchestrationScheme,
  type SubagentApplyPolicy,
  type SubagentDeliveryIntent,
} from '@piwin/contracts';

export type SchemeDeliveryLock = {
  deliveryIntent: Extract<SubagentDeliveryIntent, 'candidate'>;
  applyPolicy: Extract<SubagentApplyPolicy, 'explicit'>;
};

/**
 * Delivery fields the Host owns for a scheme role instead of the model.
 * Reviewed Delivery's promise is "apply only after an approved review"; an
 * omitted field on a worktree task defaults to integrate + auto and would land
 * the worker's change before any reviewer saw it.
 */
export function resolveSchemeDeliveryLock(
  scheme: Pick<ResolvedOrchestrationScheme, 'members'> | undefined,
  role: string | undefined,
): SchemeDeliveryLock | undefined {
  const member = role ? scheme?.members.find((candidate) => candidate.role === role) : undefined;
  if (member?.behavior?.deliveryLock === 'candidate-explicit') {
    return { deliveryIntent: 'candidate', applyPolicy: 'explicit' };
  }
  return undefined;
}
