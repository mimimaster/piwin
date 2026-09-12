/**
 * One roster row inside the orchestration scheme editor.
 *
 * Layout contract: the duty text is the thing the main agent routes on, so it
 * gets a full-width textarea on top; the five spawn knobs sit under it in one
 * wrapping grid so a four-role roster still fits on a screen.
 */
import type { ReactElement } from 'react';
import type {
  OrchestrationMemberFallback,
  OrchestrationSchemeMember,
  ThinkingLevel,
} from '@piwin/contracts';
import { Button, Select, TextArea, TextInput } from '@piwin/ui-kit';
import type { OrchestrationCopy } from './orchestration-copy';
import {
  modelSelectValue,
  THINKING_LEVELS,
  type OrchestrationMemberPatch,
  type SchemeModelOption,
} from './orchestration-scheme-draft';

export type OrchestrationMemberCardProps = {
  member: OrchestrationSchemeMember;
  index: number;
  copy: OrchestrationCopy;
  modelOptions: readonly SchemeModelOption[];
  saving: boolean;
  isDefault: boolean;
  canRemove: boolean;
  onPatch: (index: number, patch: OrchestrationMemberPatch) => void;
  onRemove: (index: number) => void;
  onMakeDefault: (role: string) => void;
};

export function OrchestrationMemberCard(props: OrchestrationMemberCardProps): ReactElement {
  const { member, index, copy, modelOptions, saving } = props;

  return (
    <article className="orch-member" data-testid={`orchestration-member-row-${index}`}>
      <header className="orch-member-head">
        <span className="orch-member-role">
          {member.role.trim() || `${copy.schemeRole} ${index + 1}`}
        </span>
        {props.isDefault ? (
          <span className="orch-badge orch-badge--default" title={copy.schemeDefaultRoleHint}>
            {copy.schemeDefaultRoleBadge}
          </span>
        ) : (
          <button
            type="button"
            className="orch-inline-action"
            disabled={saving || !member.role.trim()}
            title={copy.schemeDefaultRoleHint}
            data-testid={`orchestration-member-default-${index}`}
            onClick={() => props.onMakeDefault(member.role)}
          >
            {copy.schemeSetDefaultRole}
          </button>
        )}
        <span className="orch-spacer" />
        <Button
          size="compact"
          variant="ghost"
          disabled={saving || !props.canRemove}
          data-testid={`orchestration-member-remove-${index}`}
          onClick={() => props.onRemove(index)}
        >
          {copy.schemeRemoveMember}
        </Button>
      </header>

      <label className="orch-field orch-field--duty">
        <span className="orch-field-label">{copy.schemeRoleDesc}</span>
        <TextArea
          testId={`orchestration-member-desc-${index}`}
          value={member.description}
          placeholder={copy.schemeRoleDescPlaceholder}
          disabled={saving}
          rows={3}
          onChange={(nextValue) => props.onPatch(index, { description: nextValue })}
        />
      </label>

      <div className="orch-member-grid">
        <label className="orch-field orch-field--role">
          <span className="orch-field-label">{copy.schemeRole}</span>
          <TextInput
            testId={`orchestration-member-role-${index}`}
            value={member.role}
            disabled={saving}
            spellCheck={false}
            onChange={(event) => props.onPatch(index, { role: event.target.value })}
          />
        </label>

        <label className="orch-field">
          <span className="orch-field-label">{copy.schemeMemberModel}</span>
          <Select
            value={modelSelectValue(member.model)}
            disabled={saving}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) {
                props.onPatch(index, { model: null });
                return;
              }
              const selected = modelOptions.find((option) => option.value === value);
              if (selected) props.onPatch(index, { model: selected.ref });
            }}
          >
            <option value="">{copy.schemeModelInherit}</option>
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="orch-field">
          <span className="orch-field-label">{copy.schemeThinking}</span>
          <Select
            value={member.thinkingLevel ?? ''}
            disabled={saving}
            onChange={(event) => {
              const value = event.target.value;
              props.onPatch(index, { thinkingLevel: value ? (value as ThinkingLevel) : null });
            }}
          >
            <option value="">{copy.schemeThinkingInherit}</option>
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </Select>
        </label>

        <label className="orch-field">
          <span className="orch-field-label">{copy.schemeIsolation}</span>
          <Select
            value={member.isolation ?? 'readonly'}
            disabled={saving}
            onChange={(event) => {
              const value = event.target.value;
              props.onPatch(index, {
                isolation: value === 'worktree' || value === 'readonly' ? value : null,
              });
            }}
          >
            <option value="readonly">{copy.schemeIsolationReadonly}</option>
            <option value="worktree">{copy.schemeIsolationWorktree}</option>
          </Select>
        </label>

        <label className="orch-field">
          <span className="orch-field-label">{copy.schemeFallback}</span>
          <Select
            value={member.fallback ?? 'main'}
            disabled={saving}
            onChange={(event) =>
              props.onPatch(index, {
                fallback: event.target.value as OrchestrationMemberFallback,
              })
            }
          >
            <option value="main">{copy.schemeFallbackMain}</option>
            <option value="none">{copy.schemeFallbackNone}</option>
          </Select>
        </label>
      </div>
    </article>
  );
}
