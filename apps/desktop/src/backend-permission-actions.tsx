/**
 * Backend-owned permission choices (ADR 0082). Grok (and future ACP agents)
 * decide the options; piwin renders them verbatim with the agent's own
 * wording and never offers piwin "remember for project".
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type {
  BackendPermissionOption,
  PermissionDecision,
  PermissionRememberScope,
} from '@piwin/contracts';
import { decisionForBackendOption } from './backend-permission-options';
import { useDesktopLocale } from './desktop-locale-context';

export type BackendPermissionActionsProps = {
  options: readonly BackendPermissionOption[];
  agentLabel: string;
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
  testIdPrefix: string;
};

function variantFor(option: BackendPermissionOption, index: number): 'primary' | 'secondary' | 'danger' {
  if (option.kind === 'reject_once' || option.kind === 'reject_always') {
    return 'danger';
  }
  return index === 0 ? 'primary' : 'secondary';
}

export function BackendPermissionActions(props: BackendPermissionActionsProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  // Allow options first, reject last, preserving the agent's order within each.
  const ordered = [
    ...props.options.filter((option) => option.kind === 'allow_once' || option.kind === 'allow_always'),
    ...props.options.filter((option) => option.kind === 'reject_once' || option.kind === 'reject_always'),
  ];
  return (
    <div className="backend-permission-actions" data-testid={`${props.testIdPrefix}-backend-actions`}>
      <div className="backend-permission-options">
        {ordered.map((option, index) => (
          <Button
            key={option.optionId}
            variant={variantFor(option, index)}
            size="compact"
            data-testid={`${props.testIdPrefix}-option-${option.optionId}`}
            onClick={() => {
              const mapped = decisionForBackendOption(option);
              props.onPermission(mapped.decision, mapped.rememberScope);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="backend-permission-note muted" data-testid={`${props.testIdPrefix}-backend-note`}>
        {isZh
          ? `由 ${props.agentLabel} 决定并记住，不写入 piwin 权限规则`
          : `Decided and remembered by ${props.agentLabel}, not piwin permission rules`}
      </p>
    </div>
  );
}

export function backendAgentLabel(agentId: string | undefined): string {
  return agentId === 'grok' ? 'Grok' : (agentId ?? 'Agent');
}
