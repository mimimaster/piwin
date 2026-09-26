/**
 * Role + working-model chips for a live or completed subagent invocation.
 * Reuses conversation model-name resolution and ProviderIcon — no local mapping.
 */
import type { ReactElement } from 'react';
import type { ModelRef } from '@piwin/contracts';
import type { ModelOption } from './model-options';
import { ProviderIcon } from '@piwin/ui-kit';
import { resolveModelDisplayName } from './conversation-message-identity';

export type SubagentIdentityChipsProps = {
  role?: string;
  profileId?: string;
  model?: ModelRef;
  modelOptions?: readonly ModelOption[];
  locale: 'zh-CN' | 'en';
  /** When true and model is missing, show a resolving placeholder. */
  showModelPlaceholder?: boolean;
};

export function resolveSubagentRoleLabel(input: {
  role?: string;
  profileId?: string;
}): string | undefined {
  const role = input.role?.trim();
  if (role) return role;
  const profileId = input.profileId?.trim();
  return profileId || undefined;
}

export function SubagentIdentityChips(props: SubagentIdentityChipsProps): ReactElement | null {
  const role = resolveSubagentRoleLabel(props);
  const showModel = Boolean(props.model) || props.showModelPlaceholder === true;
  if (!role && !showModel) return null;

  return (
    <span className="subagent-identity-chips">
      {role ? (
        <span className="subagent-role-chip" data-testid="subagent-role-chip">
          {role}
        </span>
      ) : null}
      {showModel ? <SubagentModelChip {...props} /> : null}
    </span>
  );
}

function SubagentModelChip(props: SubagentIdentityChipsProps): ReactElement {
  if (!props.model) {
    return (
      <span
        className="subagent-model-chip is-resolving"
        data-testid="subagent-model-chip"
      >
        {props.locale === 'zh-CN' ? '解析模型…' : 'Resolving model…'}
      </span>
    );
  }

  const display = resolveModelDisplayName({
    model: props.model,
    ...(props.modelOptions ? { modelOptions: props.modelOptions } : {}),
  });
  const tooltip = `${props.model.providerId} / ${props.model.modelId}`;

  return (
    <span
      className="subagent-model-chip"
      data-testid="subagent-model-chip"
      title={tooltip}
    >
      <ProviderIcon
        id={props.model.providerId}
        name={display.providerName}
        modelId={props.model.modelId}
        size={14}
        className="subagent-model-chip-icon"
      />
      <span className="subagent-model-chip-label">{display.shortModelName}</span>
    </span>
  );
}
