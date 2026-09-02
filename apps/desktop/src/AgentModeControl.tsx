/**
 * Composer Agent Mode pill.
 *
 * Always-visible Agent / Goal picker in the project-session toolbar.
 * Goal is disabled when the bundled goal extension is off; the popover
 * points at Settings → Extensions.
 */
import { useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import { AGENT_MODES, getAgentMode, type AgentModeId } from './agent-mode';
import { useDesktopLocale } from './desktop-locale-context';

export type AgentModeControlProps = {
  disabled: boolean;
  value: AgentModeId;
  onChange: (mode: AgentModeId) => void;
  goalDisabled?: boolean;
  onOpenExtensionsSettings?: () => void;
};

const ZH_DESCRIPTION: Record<AgentModeId, string> = {
  agent: '默认编程智能体 — 探索、编辑、运行工具',
  goal: '自主目标执行循环（@narumirw/pi-goal）',
};

export function AgentModeControl({
  disabled,
  value,
  onChange,
  goalDisabled = false,
  onOpenExtensionsSettings,
}: AgentModeControlProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const selected = getAgentMode(value);
  const isActive = value !== 'agent';

  return (
    <div className={isActive ? 'agent-mode-control is-active' : 'agent-mode-control'}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        label={isZh ? '协作模式' : 'Agent mode'}
        testId="agent-mode-popover"
        contentClassName="agent-mode-popover"
        trigger={
          <button
            type="button"
            className="agent-mode-trigger"
            disabled={disabled}
            aria-label={isZh ? `协作模式: ${selected.label}` : `Agent mode: ${selected.label}`}
            data-testid="agent-mode-trigger"
            data-mode={value}
          >
            <span className="agent-mode-value">{selected.label}</span>
            <span className="agent-mode-chevron" aria-hidden />
          </button>
        }
      >
        <div className="agent-mode-section">
          <div className="agent-mode-section-title">{isZh ? '协作模式' : 'Agent mode'}</div>
          {AGENT_MODES.map((mode) => {
            const isGoalLocked = mode.id === 'goal' && goalDisabled;
            return (
              <button
                key={mode.id}
                type="button"
                className={
                  value === mode.id ? 'agent-mode-option is-selected' : 'agent-mode-option'
                }
                data-testid={`agent-mode-option-${mode.id}`}
                disabled={isGoalLocked}
                title={
                  isGoalLocked
                    ? isZh
                      ? '请先在 设置 → 扩展 中启用 Goal 扩展'
                      : 'Enable the Goal extension in Settings → Extensions'
                    : undefined
                }
                onClick={() => {
                  onChange(mode.id);
                  setOpen(false);
                }}
              >
                <span className="agent-mode-option-label">{mode.label}</span>
                <span className="agent-mode-option-desc">
                  {isGoalLocked
                    ? isZh
                      ? '请先在 设置 → 扩展 中启用 Goal 扩展'
                      : 'Enable the Goal extension in Settings → Extensions'
                    : isZh
                      ? ZH_DESCRIPTION[mode.id]
                      : mode.description}
                </span>
              </button>
            );
          })}
        </div>
        {onOpenExtensionsSettings && goalDisabled ? (
          <div className="agent-mode-footer">
            <button
              type="button"
              className="agent-mode-footer-btn"
              data-testid="agent-mode-open-extensions"
              onClick={() => {
                setOpen(false);
                onOpenExtensionsSettings();
              }}
            >
              {isZh ? '管理扩展…' : 'Extensions…'}
            </button>
          </div>
        ) : null}
      </Popover>
    </div>
  );
}
