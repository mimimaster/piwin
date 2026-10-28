/**
 * The orchestration picker's body: schemes, the delegation switch, manage.
 * Shared by the composer pill and the phone's combined mode sheet, so both
 * show the same rows with the same test ids.
 */
import type { ReactElement } from 'react';

export type OrchestrationSchemeOption = {
  id: string;
  name: string;
  description: string;
  source?: 'builtin' | 'settings' | 'off';
  /** Default role inherits the composer model (no pinned member.model). */
  unpinnedDefaultRole?: string;
};

export type OrchestrationSchemeOptionsProps = {
  isZh: boolean;
  value: string;
  options: readonly OrchestrationSchemeOption[];
  onChange: (schemeId: string) => void;
  delegationDisabled: boolean;
  onDelegationDisabledChange?: ((disabled: boolean) => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  /** The surrounding popover closes after a pick or a jump to settings. */
  onDone: () => void;
};

function isFreehand(option: OrchestrationSchemeOption): boolean {
  return option.id === 'off' || option.source === 'off';
}

/** Freehand is a mode value, not a power switch — only named schemes inject. */
export function orchestrationSchemeLabel(
  option: OrchestrationSchemeOption | undefined,
  isZh: boolean,
): string {
  if (!option) return isZh ? '无' : 'None';
  if (isFreehand(option)) return isZh ? '自由' : 'Freehand';
  return option.name;
}

function schemeDescription(option: OrchestrationSchemeOption, isZh: boolean): string {
  if (isFreehand(option)) {
    return isZh
      ? '自由对话 — 不注入方案提示；仍可自主委派'
      : 'Freehand — no scheme prompt; delegation remains available';
  }
  return option.description;
}

export function selectedOrchestrationScheme(
  options: readonly OrchestrationSchemeOption[],
  value: string,
): OrchestrationSchemeOption | undefined {
  return options.find((option) => option.id === value) ?? options.find((option) => option.id === 'off') ?? options[0];
}

/** Hint when the active scheme's default role has no pinned model. */
export function unpinnedSchemeHint(
  options: readonly OrchestrationSchemeOption[],
  value: string,
  isZh: boolean,
): string | undefined {
  const selected = selectedOrchestrationScheme(options, value);
  const active = value !== 'off' && value !== '';
  const role = active && selected && !isFreehand(selected) ? selected.unpinnedDefaultRole : undefined;
  if (!role) return undefined;
  return isZh
    ? `${role} 未指定模型，将使用当前主模型价位`
    : `${role} has no pinned model — it will use the composer model`;
}

export function OrchestrationSchemeOptions(props: OrchestrationSchemeOptionsProps): ReactElement {
  const { isZh, value, options, onChange, delegationDisabled, onDelegationDisabledChange, onOpenSettings, onDone } =
    props;
  const unpinnedHint = unpinnedSchemeHint(options, value, isZh);
  return (
    <>
      <div className="orchestration-scheme-section">
        <div className="orchestration-scheme-section-title">{isZh ? '编排方案' : 'Orchestration scheme'}</div>
        {options.map((option) => {
          const isSelected = option.id === (value || 'off');
          return (
            <button
              key={option.id}
              type="button"
              className={isSelected ? 'orchestration-scheme-option is-selected' : 'orchestration-scheme-option'}
              data-testid={`orchestration-scheme-option-${option.id}`}
              onClick={() => {
                onChange(option.id);
                onDone();
              }}
            >
              <span className="orchestration-scheme-option-label">{orchestrationSchemeLabel(option, isZh)}</span>
              <span className="orchestration-scheme-option-desc">{schemeDescription(option, isZh)}</span>
            </button>
          );
        })}
        {unpinnedHint ? (
          <button
            type="button"
            className="orchestration-scheme-unpinned-hint"
            data-testid="orchestration-scheme-unpinned-hint"
            onClick={() => {
              if (!onOpenSettings) return;
              onDone();
              onOpenSettings();
            }}
            disabled={!onOpenSettings}
            title={unpinnedHint}
          >
            {unpinnedHint}
          </button>
        ) : null}
      </div>
      {onDelegationDisabledChange ? (
        <div className="orchestration-scheme-section">
          <button
            type="button"
            className="orchestration-scheme-option orchestration-delegation-toggle"
            data-testid="orchestration-delegation-disabled"
            role="switch"
            aria-checked={delegationDisabled}
            onClick={() => onDelegationDisabledChange(!delegationDisabled)}
          >
            <span className="orchestration-scheme-option-label">{isZh ? '禁用委派' : 'Delegation disabled'}</span>
            <span className="orchestration-scheme-option-desc">
              {isZh ? '本轮不向模型提供 Reviewer/Subagent 工具' : 'Do not expose Reviewer/subagent tools for this turn'}
            </span>
            {/* A switch, not a choice: it reads on or off at a glance. */}
            <span className="orchestration-delegation-switch" aria-hidden />
          </button>
        </div>
      ) : null}
      {onOpenSettings ? (
        <div className="orchestration-scheme-footer">
          <button
            type="button"
            className="orchestration-scheme-footer-btn"
            data-testid="orchestration-scheme-manage"
            onClick={() => {
              onDone();
              onOpenSettings();
            }}
          >
            {isZh ? '管理方案…' : 'Manage schemes…'}
          </button>
        </div>
      ) : null}
    </>
  );
}
