/**
 * Composer Orchestration Scheme pill (ORCH).
 *
 * Always-on mode picker in the composer toolbar (not a feature switch).
 * Default selection is freehand (`off`) — no scheme preamble is injected.
 * Choosing Ultra Code (or a user scheme) sets PromptInput.orchestrationSchemeId
 * for that send only. No "set as default"; no cross-session persistence.
 */
import { useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type OrchestrationSchemeOption = {
  id: string;
  name: string;
  description: string;
  source?: 'builtin' | 'settings' | 'off';
};

export type OrchestrationSchemeControlProps = {
  disabled: boolean;
  value: string;
  options: readonly OrchestrationSchemeOption[];
  onChange: (schemeId: string) => void;
  onOpenSettings?: () => void;
};

export function OrchestrationSchemeControl({
  disabled,
  value,
  options,
  onChange,
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
      return isZh ? '无' : 'None';
    }
    return option.name;
  };
  const displayDescription = (option: OrchestrationSchemeOption): string => {
    if (option.id === 'off' || option.source === 'off') {
      return isZh
        ? '自由对话 — 不注入编排提示词'
        : 'Freehand — no scheme prompt injection';
    }
    return option.description;
  };
  const selectedLabel = displayName(selected);

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
            aria-label={
              isZh ? `编排方案: ${selectedLabel}` : `Orchestration scheme: ${selectedLabel}`
            }
            data-testid="orchestration-scheme-trigger"
            data-scheme={value || 'off'}
          >
            <span className="orchestration-scheme-prefix">
              {isZh ? '编排' : 'Scheme'}
            </span>
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
        </div>
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
