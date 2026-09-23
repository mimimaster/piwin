import {
  REVIEWED_DELIVERY_SCHEME_ID,
  REVIEWED_DELIVERY_WORKER_ROLE,
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
  scheme: Pick<ResolvedOrchestrationScheme, 'schemeId'> | undefined,
  role: string | undefined,
): SchemeDeliveryLock | undefined {
  if (scheme?.schemeId === REVIEWED_DELIVERY_SCHEME_ID && role === REVIEWED_DELIVERY_WORKER_ROLE) {
    return { deliveryIntent: 'candidate', applyPolicy: 'explicit' };
  }
  return undefined;
}
