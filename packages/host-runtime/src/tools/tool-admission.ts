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
  type PermissionSubject,
  type ToolResult,
} from '@piwin/contracts';
import {
  createToolApprovalBroker,
  type ToolApprovalBroker,
  type ToolApprovalBrokerOptions,
} from './tool-approval-broker.js';
import { canonicalFsPath } from '@piwin/process';
import { hostToolPolicyEvaluator, type ToolPolicyEvaluator } from './tool-policy-evaluator.js';
import type { ToolResourceGate } from '../system-memory.js';
export type HostToolAdmissionDecision =
  | { allowed: true }
  | { allowed: false; result: ToolResult };

export type HostToolAdmission = {
  policyEvaluator: ToolPolicyEvaluator;
  approvalBroker: ToolApprovalBroker;
  getPermissionMode: () => PermissionMode;
  rules: PermissionRuleSet;
  /** Canonical (real path) workspace root; empty for unbound sessions. */
  projectRoot: string;
  /** Real-path resolver for boundary comparisons; omitted in tests. */
  canonicalizePath?: (path: string) => string;
  /**
   * Host resource admission, consulted before policy. Omitted means no
   * resource gating — the product default supplies a memory gate.
   */
  resourceGate?: ToolResourceGate;
  onDiagnostic?: (message: string) => void;
};

export type HostToolAdmissionOptions = ToolApprovalBrokerOptions & {
  rules: PermissionRuleSet;
  getPermissionMode: () => PermissionMode;
  projectRoot: string;
  resourceGate?: ToolResourceGate;
};

export function createHostToolAdmission(options: HostToolAdmissionOptions): HostToolAdmission {
  const projectRoot = options.projectRoot.trim();
  return {
    policyEvaluator: hostToolPolicyEvaluator,
    approvalBroker: createToolApprovalBroker(options),
    getPermissionMode: options.getPermissionMode,
    rules: options.rules,
    // Compared by real path on both sides: a project opened through a symlink
    // still contains paths spelled through its target (ADR 0019 §4.1).
    projectRoot: projectRoot.length > 0 ? canonicalFsPath(projectRoot) : '',
    canonicalizePath: canonicalFsPath,
    ...(options.resourceGate ? { resourceGate: options.resourceGate } : {}),
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
    // Resource admission precedes policy on purpose: a command the Host will
    // not run must not raise a permission prompt the user then approves for
    // nothing. Read-only tools are never gated (see actionSpawnsSubprocesses).
    const resource = input.admission.resourceGate?.({
      action: input.registration.permissionSpec.action,
    });
    if (resource?.refuse) {
      input.admission.onDiagnostic?.(
        `resource admission refused ${input.registration.descriptor.name}: ` +
          `${resource.availableMiB} MiB available, floor ${resource.requiredMiB} MiB`,
      );
      return {
        allowed: false,
        result: {
          ok: false,
          code: 'execution-failed',
          message: resource.message,
          details: { reason: resource.reason },
          retryable: true,
        },
      };
    }
    const outcome = input.admission.policyEvaluator.evaluate({
      registration: input.registration,
      arguments: input.args,
      context: input.context,
      rules: input.admission.rules,
      mode: input.admission.getPermissionMode(),
      projectRoot: input.admission.projectRoot,
      ...(input.admission.canonicalizePath
        ? { canonicalizePath: input.admission.canonicalizePath }
        : {}),
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
        outcome.policy.action,
        outcome.policy.subject,
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
          : denied(
              input.registration.descriptor.name,
              'permission-denied',
              approval.reason,
              outcome.policy.action,
              outcome.policy.subject,
            );
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

/**
 * Boundary refusals say what happened in words (ADR 0019 §4.1). A bare reason
 * code left models guessing — one concluded a worktree "is not trusted" and
 * stopped trying instead of reporting that the user said no.
 */
function denied(
  toolName: string,
  code: Extract<ToolResult, { ok: false }>['code'],
  reason: string,
  action?: string,
  subject?: PermissionSubject,
): HostToolAdmissionDecision {
  const paths = subject?.kind === 'file-paths'
    ? subject.paths.join(', ')
    : subject?.kind === 'file-write'
      ? subject.path
      : subject?.kind === 'process'
        ? subject.cwd
        : undefined;
  const explanation = reason === 'cwd-outside-workspace'
    ? `running a process in ${paths ?? 'that directory'} outside this session's workspace was not approved`
    : reason === 'path-escapes-project-root'
      ? `${action === 'browser:upload' ? 'uploading' : 'writing to'} ${paths ?? 'that path'} outside this session's workspace was not approved`
      : undefined;
  return {
    allowed: false,
    result: {
      ok: false,
      code,
      message: explanation
        ? `Permission denied for ${toolName}: ${explanation} (${reason})`
        : `Permission denied for ${toolName}: ${reason}`,
    },
  };
}
