/**
 * Composer Orchestration Scheme pill (ORCH).
 *
 * Always-on mode picker in the composer toolbar (not a feature switch).
 * Default selection is freehand (`off`) — no scheme preamble is injected, but
 * the model may still delegate when useful. Delegation can be disabled
 * independently for the current turn.
 * Choosing Ultra Code (or a user scheme) attaches PromptInput.orchestrationSchemeId
 * to that send. The pill stays on the chosen scheme for this conversation,
 * including later turns and returning to this session. New Agent starts
 * freehand. No "set as default".
 */
import { useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type OrchestrationSchemeOption = {
  id: string;
  name: string;
  description: string;
  source?: 'builtin' | 'settings' | 'off';
  /** Default role inherits the composer model (no pinned member.model). */
  unpinnedDefaultRole?: string;
};

export type OrchestrationSchemeControlProps = {
  disabled: boolean;
  value: string;
  options: readonly OrchestrationSchemeOption[];
  onChange: (schemeId: string) => void;
  delegationDisabled?: boolean;
  onDelegationDisabledChange?: (disabled: boolean) => void;
  onOpenSettings?: () => void;
};

export function OrchestrationSchemeControl({
  disabled,
  value,
  options,
  onChange,
  delegationDisabled = false,
  onDelegationDisabledChange,
  onOpenSettings,
}: OrchestrationSchemeControlProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const selected =
    options.find((option) => option.id === value) ??
    options.find((option) => option.id === 'off') ??
    options[0];
  const isActive = value !== 'off' && value !== '';
  const displayName = (option: OrchestrationSchemeOption | undefined): string => {
    if (!option) {
      return isZh ? '无' : 'None';
    }
    // Freehand is a mode value, not a power switch — only named schemes inject.
    if (option.id === 'off' || option.source === 'off') {
      return isZh ? '自由' : 'Freehand';
    }
    return option.name;
  };
  const displayDescription = (option: OrchestrationSchemeOption): string => {
    if (option.id === 'off' || option.source === 'off') {
      return isZh
        ? '自由对话 — 不注入方案提示；仍可自主委派'
        : 'Freehand — no scheme prompt; delegation remains available';
    }
    return option.description;
  };
  const selectedLabel = displayName(selected);
  const unpinnedDefaultRole =
    isActive && selected && selected.id !== 'off' && selected.source !== 'off'
      ? selected.unpinnedDefaultRole
      : undefined;
  const unpinnedHint = unpinnedDefaultRole
    ? isZh
      ? `${unpinnedDefaultRole} 未指定模型，将使用当前主模型价位`
      : `${unpinnedDefaultRole} has no pinned model — it will use the composer model`
    : undefined;

  return (
    <div
      className={
        isActive ? 'orchestration-scheme-control is-active' : 'orchestration-scheme-control'
      }
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        label={isZh ? '编排方案' : 'Orchestration scheme'}
        testId="orchestration-scheme-popover"
        contentClassName="orchestration-scheme-popover"
        trigger={
          <button
            type="button"
            className="orchestration-scheme-trigger"
            disabled={disabled}
            {...(unpinnedHint ? { title: unpinnedHint } : {})}
            aria-label={
              isZh ? `编排方案: ${selectedLabel}` : `Orchestration scheme: ${selectedLabel}`
            }
            data-testid="orchestration-scheme-trigger"
            data-scheme={value || 'off'}
          >
            <span className="orchestration-scheme-value">{selectedLabel}</span>
            <span className="orchestration-scheme-chevron" aria-hidden />
          </button>
        }
      >
        <div className="orchestration-scheme-section">
          <div className="orchestration-scheme-section-title">
            {isZh ? '编排方案' : 'Orchestration scheme'}
          </div>
          {options.map((option) => {
            const isSelected = option.id === (value || 'off');
            return (
              <button
                key={option.id}
                type="button"
                className={
                  isSelected
                    ? 'orchestration-scheme-option is-selected'
                    : 'orchestration-scheme-option'
                }
                data-testid={`orchestration-scheme-option-${option.id}`}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="orchestration-scheme-option-label">
                  {displayName(option)}
                </span>
                <span className="orchestration-scheme-option-desc">
                  {displayDescription(option)}
                </span>
              </button>
            );
          })}
          {unpinnedHint ? (
            <button
              type="button"
              className="orchestration-scheme-unpinned-hint"
              data-testid="orchestration-scheme-unpinned-hint"
              onClick={() => {
                if (!onOpenSettings) {
                  return;
                }
                setOpen(false);
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
              className={
                delegationDisabled
                  ? 'orchestration-scheme-option is-selected'
                  : 'orchestration-scheme-option'
              }
              data-testid="orchestration-delegation-disabled"
              aria-pressed={delegationDisabled}
              onClick={() => onDelegationDisabledChange(!delegationDisabled)}
            >
              <span className="orchestration-scheme-option-label">
                {isZh ? '禁用委派' : 'Delegation disabled'}
              </span>
              <span className="orchestration-scheme-option-desc">
                {isZh
                  ? '本轮不向模型提供 Reviewer/Subagent 工具'
                  : 'Do not expose Reviewer/subagent tools for this turn'}
              </span>
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
                setOpen(false);
                onOpenSettings();
              }}
            >
              {isZh ? '管理方案…' : 'Manage schemes…'}
            </button>
          </div>
        ) : null}
      </Popover>
    </div>
  );
}
