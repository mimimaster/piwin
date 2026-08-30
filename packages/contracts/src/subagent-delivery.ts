/** Delivery intent, result refs, and field-parse contracts for subagent results. */

import type { SubagentApplyPolicy } from './subagent.js';

export type SubagentDeliveryIntent = 'report' | 'integrate' | 'candidate';

export type SubagentResultRef = { resultId: string; revision: number };

export type ChangeVersionRef = { changeSetId: string; revision: number };

export type SubagentCopyState = 'present' | 'cleanup-pending' | 'removed' | 'missing';

export type SubagentResultActionAvailability = {
  allowed: boolean;
  reason?: string;
};

export type SubagentResultAvailability = {
  view: SubagentResultActionAvailability;
  apply: SubagentResultActionAvailability;
  resolve: SubagentResultActionAvailability;
  cleanup: SubagentResultActionAvailability;
};

export type SubagentDeliveryFieldErrorCode =
  | 'unknown-intent'
  | 'unknown-apply-policy'
  | 'conflicting-fields';

export type SubagentDeliveryFieldParse =
  | {
      ok: true;
      deliveryIntent: SubagentDeliveryIntent | undefined;
      applyPolicy: SubagentApplyPolicy | undefined;
    }
  | {
      ok: false;
      code: SubagentDeliveryFieldErrorCode;
      message: string;
    };

export type SubagentDeliveryFieldsInput = {
  deliveryIntent?: string;
  applyPolicy?: string;
};

const DELIVERY_INTENTS = new Set<SubagentDeliveryIntent>(['report', 'integrate', 'candidate']);
const APPLY_POLICIES = new Set<SubagentApplyPolicy>(['none', 'auto', 'explicit']);

function isDeliveryIntent(value: string): value is SubagentDeliveryIntent {
  return DELIVERY_INTENTS.has(value as SubagentDeliveryIntent);
}

function isApplyPolicy(value: string): value is SubagentApplyPolicy {
  return APPLY_POLICIES.has(value as SubagentApplyPolicy);
}

function deliveryFieldsConflict(
  deliveryIntent: SubagentDeliveryIntent,
  applyPolicy: SubagentApplyPolicy,
): boolean {
  if (deliveryIntent === 'report') return applyPolicy !== 'none';
  if (deliveryIntent === 'integrate') return applyPolicy !== 'auto';
  return applyPolicy === 'auto';
}

/**
 * Parse caller-supplied delivery fields. Unknown values fail closed; omitted
 * fields stay undefined. Does not resolve Host policy defaults.
 */
export function parseSubagentDeliveryFields(
  input: SubagentDeliveryFieldsInput = {},
): SubagentDeliveryFieldParse {
  const rawIntent = input.deliveryIntent;
  const rawPolicy = input.applyPolicy;

  let deliveryIntent: SubagentDeliveryIntent | undefined;
  if (typeof rawIntent === 'string' && rawIntent.length > 0) {
    if (!isDeliveryIntent(rawIntent)) {
      return { ok: false, code: 'unknown-intent', message: 'unknown deliveryIntent' };
    }
    deliveryIntent = rawIntent;
  }

  let applyPolicy: SubagentApplyPolicy | undefined;
  if (typeof rawPolicy === 'string' && rawPolicy.length > 0) {
    if (!isApplyPolicy(rawPolicy)) {
      return { ok: false, code: 'unknown-apply-policy', message: 'unknown applyPolicy' };
    }
    applyPolicy = rawPolicy;
  }

  if (
    deliveryIntent !== undefined &&
    applyPolicy !== undefined &&
    deliveryFieldsConflict(deliveryIntent, applyPolicy)
  ) {
    return {
      ok: false,
      code: 'conflicting-fields',
      message: 'deliveryIntent and applyPolicy conflict',
    };
  }

  return { ok: true, deliveryIntent, applyPolicy };
}
