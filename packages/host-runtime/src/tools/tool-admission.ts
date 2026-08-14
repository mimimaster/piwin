/**
 * Production composition of the pure policy evaluator and the approval broker.
 */

import {
  createEmptyRuleSet,
  formatError,
  type HostToolExecutionContext,
  type HostToolRegistration,
  type PermissionMode,
  type PermissionRuleSet,
  type ToolResult,
} from '@piwin/contracts';
import {
  createToolApprovalBroker,
  type ToolApprovalBroker,
  type ToolApprovalBrokerOptions,
} from './tool-approval-broker.js';
import { hostToolPolicyEvaluator, type ToolPolicyEvaluator } from './tool-policy-evaluator.js';
export type HostToolAdmissionDecision =
  | { allowed: true }
  | { allowed: false; result: ToolResult };

export type HostToolAdmission = {
  policyEvaluator: ToolPolicyEvaluator;
  approvalBroker: ToolApprovalBroker;
  getPermissionMode: () => PermissionMode;
  rules: PermissionRuleSet;
  projectRoot: string;
  onDiagnostic?: (message: string) => void;
};

export type HostToolAdmissionOptions = ToolApprovalBrokerOptions & {
  rules: PermissionRuleSet;
  getPermissionMode: () => PermissionMode;
  projectRoot: string;
};

export function createHostToolAdmission(options: HostToolAdmissionOptions): HostToolAdmission {
  return {
    policyEvaluator: hostToolPolicyEvaluator,
    approvalBroker: createToolApprovalBroker(options),
    getPermissionMode: options.getPermissionMode,
    rules: options.rules,
    projectRoot: options.projectRoot,
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
  };
}

export function createPermissiveToolAdmission(): HostToolAdmission {
  return {
    policyEvaluator: {
      evaluate: () => ({
        kind: 'decision',
        policy: {
          decision: 'allow',
          reason: 'test-allow',
          action: 'filesystem:read',
          rememberable: false,
        },
      }),
    },
    approvalBroker: {
      resolve: async () => ({ allowed: true, source: 'user' }),
    },
    getPermissionMode: () => 'bypass',
    rules: createEmptyRuleSet(),
    projectRoot: '/tmp',
  };
}

export async function resolveHostToolAdmission(input: {
  admission: HostToolAdmission;
  registration: HostToolRegistration;
  args: Record<string, unknown>;
  context: HostToolExecutionContext;
  signal: AbortSignal;
}): Promise<HostToolAdmissionDecision> {
  try {
    const outcome = input.admission.policyEvaluator.evaluate({
      registration: input.registration,
      arguments: input.args,
      context: input.context,
      rules: input.admission.rules,
      mode: input.admission.getPermissionMode(),
      projectRoot: input.admission.projectRoot,
    });
    if (outcome.kind === 'invalid-input') {
      return {
        allowed: false,
        result: { ok: false, code: 'invalid-input', message: outcome.message },
      };
    }
    if (outcome.kind === 'unclassified') {
      return denied(
        input.registration.descriptor.name,
        'permission-denied',
        outcome.reason,
      );
    }
    if (outcome.policy.decision === 'deny') {
      return denied(
        input.registration.descriptor.name,
        'permission-denied',
        outcome.policy.reason,
      );
    }
    if (outcome.policy.decision === 'ask') {
      const approval = await input.admission.approvalBroker.resolve({
        invocationId: input.context.toolCallId ?? input.context.runId,
        registration: input.registration,
        arguments: input.args,
        context: input.context,
        policy: outcome.policy,
        signal: input.signal,
      });
      if (!approval.allowed) {
        return input.signal.aborted
          ? { allowed: false, result: { ok: false, code: 'aborted', message: 'tool approval aborted' } }
          : denied(input.registration.descriptor.name, 'permission-denied', approval.reason);
      }
    }
    return { allowed: true };
  } catch (error) {
    const diagnostic = `permission admission failed for ${input.registration.descriptor.name}: ${formatError(error)}`;
    input.admission.onDiagnostic?.(diagnostic);
    return {
      allowed: false,
      result: input.signal.aborted
        ? { ok: false, code: 'aborted', message: 'permission admission aborted' }
        : {
            ok: false,
            code: 'permission-denied',
            message: `Permission admission failed for ${input.registration.descriptor.name}`,
          },
    };
  }
}

function denied(
  toolName: string,
  code: Extract<ToolResult, { ok: false }>['code'],
  reason: string,
): HostToolAdmissionDecision {
  return {
    allowed: false,
    result: {
      ok: false,
      code,
      message: `Permission denied for ${toolName}: ${reason}`,
    },
  };
}

