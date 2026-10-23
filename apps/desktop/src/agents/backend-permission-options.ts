/**
 * External-agent permission options (ADR 0082) mapped onto the existing
 * `(decision, rememberScope)` permission callback so every UI layer keeps its
 * signature. The Host receives the exact backend option id; piwin remembered
 * scopes are never applied to another agent.
 *
 * Mapping (one option per ACP kind):
 *   allow_once    ↔ ('allow', 'once')
 *   allow_always  ↔ ('allow', 'session')
 *   reject_once   ↔ ('deny', 'once')
 *   reject_always ↔ ('deny', 'session')
 */
import type {
  BackendPermissionOption,
  PermissionDecision,
  PermissionRememberScope,
  PermissionRequestContext,
} from '@piwin/contracts';

export function backendPermissionOptions(
  context: PermissionRequestContext | null | undefined,
): readonly BackendPermissionOption[] | undefined {
  const options = context?.backendOptions;
  return options !== undefined && options.length > 0 ? options : undefined;
}

export function decisionForBackendOption(option: BackendPermissionOption): {
  decision: PermissionDecision;
  rememberScope: PermissionRememberScope;
} {
  switch (option.kind) {
    case 'allow_once':
      return { decision: 'allow', rememberScope: 'once' };
    case 'allow_always':
      return { decision: 'allow', rememberScope: 'session' };
    case 'reject_once':
      return { decision: 'deny', rememberScope: 'once' };
    case 'reject_always':
      return { decision: 'deny', rememberScope: 'session' };
  }
}

/** Resolve the backend option a `(decision, scope)` gesture stands for. */
export function backendOptionForDecision(
  options: readonly BackendPermissionOption[],
  decision: PermissionDecision,
  rememberScope: PermissionRememberScope | undefined,
): BackendPermissionOption | undefined {
  const scope = rememberScope ?? 'once';
  const exact = options.find((option) => {
    const mapped = decisionForBackendOption(option);
    return mapped.decision === decision && mapped.rememberScope === scope;
  });
  if (exact !== undefined) {
    return exact;
  }
  // Keyboard shortcuts send ('allow','session') / ('deny'); fall back to the
  // closest option of the same polarity so a shortcut never picks the wrong side.
  const wantAllow = decision === 'allow';
  return options.find((option) => (option.kind === 'allow_once' || option.kind === 'allow_always') === wantAllow);
}
