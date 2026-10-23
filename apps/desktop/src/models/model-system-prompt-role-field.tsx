/**
 * Per-model system prompt role (ADR 0082). A gateway row can route one model
 * to an upstream that only accepts `system` while the rest keep `developer`.
 * Only shown when the model's effective wire is OpenAI-compatible.
 */
import type { ChangeEvent, ReactElement } from 'react';
import { isSystemPromptRoleMode, type SystemPromptRoleMode } from '@piwin/contracts';

export function ModelSystemPromptRoleField(props: {
  /** '' or omitted = inherit the provider setting. */
  value: SystemPromptRoleMode | '' | undefined;
  /** Provider setting; omitted = `developer`. */
  providerRole: SystemPromptRoleMode | undefined;
  disabled?: boolean;
  isChinese: boolean;
  testId: string;
  onChange: (role: SystemPromptRoleMode | '') => void;
}): ReactElement {
  const zh = props.isChinese;
  const inherited = props.providerRole ?? 'developer';
  return (
    <label className="model-edit-field-group">
      <span className="model-edit-field-label">{zh ? '系统提示角色' : 'System prompt role'}</span>
      <select
        value={props.value ?? ''}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          const value = event.target.value;
          props.onChange(isSystemPromptRoleMode(value) ? value : '');
        }}
      >
        <option value="">
          {zh ? `跟随服务商（${inherited}）` : `Provider default (${inherited})`}
        </option>
        <option value="developer">developer</option>
        <option value="system">system</option>
      </select>
    </label>
  );
}
