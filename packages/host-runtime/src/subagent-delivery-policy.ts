import {
  parseSubagentDeliveryFields,
  type SubagentApplyPolicy,
  type SubagentDeliveryIntent,
  type SubagentIsolationMode,
} from '@piwin/contracts';

export type SubagentDeliveryPolicySource = 'model-tool' | 'plan' | 'cli' | 'batch' | 'legacy';

export type ResolvedSubagentDeliveryPolicy = {
  deliveryIntent: SubagentDeliveryIntent;
  legacyManual: boolean;
  /**
   * What the current orchestrator may use for file integrate.
   * W1: new integrate default does NOT become applyPolicy auto.
   */
  applyPolicy: SubagentApplyPolicy;
};

export type ResolveSubagentDeliveryPolicyInput = {
  deliveryIntent?: unknown;
  applyPolicy?: unknown;
  isolation: SubagentIsolationMode;
  source: SubagentDeliveryPolicySource;
  /**
   * When false (W1), an inferred or explicit integrate intent is recorded
   * but applyPolicy stays 'none' unless the caller explicitly passed 'auto'
   * or 'explicit'.
   */
  activateNewIntegrateDefault: boolean;
};

export type ResolveSubagentDeliveryPolicyResult =
  | { ok: true; policy: ResolvedSubagentDeliveryPolicy }
  | { ok: false; code: string; message: string };

/** Flip after capture, freeze, and safe apply exist. */
export const ACTIVATE_NEW_INTEGRATE_DEFAULT = true;

export const SUBAGENT_DELIVERY_POLICY_ERROR_CODES = [
  'unknown-intent',
  'unknown-apply-policy',
  'conflicting-fields',
  'report-with-write',
  'write-intent-readonly',
] as const;

export function isSubagentDeliveryPolicyError(message: string): boolean {
  return SUBAGENT_DELIVERY_POLICY_ERROR_CODES.some((code) => message.includes(code));
}

function asDeliveryField(value: unknown):
  | { ok: true; value: string | undefined }
  | { ok: false; code: string; message: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value === 'string') return { ok: true, value };
  return { ok: false, code: 'unknown-intent', message: 'unknown deliveryIntent' };
}

function asApplyPolicyField(value: unknown):
  | { ok: true; value: string | undefined }
  | { ok: false; code: string; message: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value === 'string') return { ok: true, value };
  return { ok: false, code: 'unknown-apply-policy', message: 'unknown applyPolicy' };
}

function resolveApplyPolicy(
  input: ResolveSubagentDeliveryPolicyInput,
  deliveryIntent: SubagentDeliveryIntent,
  legacyManual: boolean,
  parsedApplyPolicy: SubagentApplyPolicy | undefined,
): SubagentApplyPolicy {
  if (parsedApplyPolicy === 'auto' || parsedApplyPolicy === 'explicit') {
    return parsedApplyPolicy;
  }
  if (
    input.activateNewIntegrateDefault &&
    deliveryIntent === 'integrate' &&
    !legacyManual
  ) {
    return 'auto';
  }
  return 'none';
}

/**
 * Resolve caller delivery fields against isolation. Does not read retainWorktree
 * and does not guess intent from task text.
 */
export function resolveSubagentDeliveryPolicy(
  input: ResolveSubagentDeliveryPolicyInput,
): ResolveSubagentDeliveryPolicyResult {
  const deliveryField = asDeliveryField(input.deliveryIntent);
  if (!deliveryField.ok) return deliveryField;
  const applyField = asApplyPolicyField(input.applyPolicy);
  if (!applyField.ok) return applyField;

  const parsed = parseSubagentDeliveryFields({
    ...(deliveryField.value !== undefined ? { deliveryIntent: deliveryField.value } : {}),
    ...(applyField.value !== undefined ? { applyPolicy: applyField.value } : {}),
  });
  if (!parsed.ok) return parsed;

  if (
    input.source === 'plan' &&
    input.isolation === 'readonly' &&
    parsed.deliveryIntent === undefined &&
    parsed.applyPolicy === 'auto'
  ) {
    return {
      ok: true,
      policy: {
        deliveryIntent: 'report',
        legacyManual: false,
        applyPolicy: 'none',
      },
    };
  }

  let deliveryIntent: SubagentDeliveryIntent;
  let legacyManual = false;
  if (parsed.deliveryIntent !== undefined) {
    deliveryIntent = parsed.deliveryIntent;
  } else if (parsed.applyPolicy === 'auto') {
    deliveryIntent = 'integrate';
  } else if (parsed.applyPolicy === 'none' || parsed.applyPolicy === 'explicit') {
    deliveryIntent = 'integrate';
    legacyManual = true;
  } else {
    deliveryIntent = input.isolation === 'readonly' ? 'report' : 'integrate';
  }

  if (deliveryIntent === 'report' && input.isolation === 'worktree') {
    return {
      ok: false,
      code: 'report-with-write',
      message: 'report deliveryIntent is incompatible with worktree isolation',
    };
  }
  if (
    (deliveryIntent === 'candidate' || deliveryIntent === 'integrate') &&
    input.isolation === 'readonly' &&
    !legacyManual
  ) {
    return {
      ok: false,
      code: 'write-intent-readonly',
      message: `${deliveryIntent} deliveryIntent is incompatible with readonly isolation`,
    };
  }

  return {
    ok: true,
    policy: {
      deliveryIntent,
      legacyManual,
      applyPolicy: resolveApplyPolicy(
        input,
        deliveryIntent,
        legacyManual,
        parsed.applyPolicy,
      ),
    },
  };
}
