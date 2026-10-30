/**
 * Phone titleband "⋯" session menu. On a phone the composer carries no run
 * mode pill; this sheet is the one place to change it, per conversation.
 * "Follow Host" (the default) sends no preset, so the Host config decides.
 */
import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { PermissionPreset } from '@piwin/contracts';
import './phone-session-menu.css';

type Choice = PermissionPreset | null;

export type PhoneSessionMenuProps = {
  isZh: boolean;
  value: PermissionPreset;
  isOverride: boolean;
  hostValue: PermissionPreset;
  disabled?: boolean;
  onChange: (preset: Choice) => void;
  onOpenSettings?: () => void;
};

function presetLabel(preset: PermissionPreset, isZh: boolean): string {
  if (preset === 'auto') return isZh ? '自动' : 'Auto';
  if (preset === 'ask') return isZh ? '每次询问' : 'Ask';
  return isZh ? '放行' : 'YOLO';
}

function presetDetail(preset: PermissionPreset, isZh: boolean): string {
  if (preset === 'auto')
    return isZh
      ? '项目内自动执行；离开项目目录时询问'
      : 'Runs inside the project; asks before leaving it';
  if (preset === 'ask')
    return isZh ? '几乎每个工具调用都先确认' : 'Confirms almost every tool call';
  return isZh
    ? '不再询问（未受信任的项目按自动运行）'
    : 'Never asks (untrusted projects run as Auto)';
}

export function PhoneSessionMenu(props: PhoneSessionMenuProps): ReactElement {
  const { isZh } = props;
  const [open, setOpen] = useState(false);
  const current: Choice = props.isOverride ? props.value : null;
  const choices: Array<{ id: Choice; label: string; detail: string }> = [
    {
      id: null,
      label: isZh ? '跟随 Host 默认' : 'Follow Host default',
      detail: isZh
        ? `当前：${presetLabel(props.hostValue, true)}`
        : `Now: ${presetLabel(props.hostValue, false)}`,
    },
    ...(['auto', 'ask', 'yolo'] as const).map((preset) => ({
      id: preset,
      label: presetLabel(preset, isZh),
      detail: presetDetail(preset, isZh),
    })),
  ];
  return (
    <>
      <button
        type="button"
        className="ib context-bar-session-menu-btn"
        data-testid="phone-session-menu-btn"
        aria-label={isZh ? '会话菜单' : 'Session menu'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="4" cy="9" r="1.4" fill="currentColor" />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" />
          <circle cx="14" cy="9" r="1.4" fill="currentColor" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div className="psm-layer" data-testid="phone-session-menu">
              <div className="psm-scrim" onClick={() => setOpen(false)} />
              <div
                className="psm-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={isZh ? '会话菜单' : 'Session menu'}
              >
                <span className="psm-grab" aria-hidden />
                <div className="psm-sec">
                  {isZh ? '运行模式' : 'Run mode'}
                  <span>{isZh ? '仅本会话' : 'This conversation only'}</span>
                </div>
                <div role="radiogroup" aria-label={isZh ? '运行模式' : 'Run mode'}>
                  {choices.map((choice) => {
                    const on = choice.id === current;
                    return (
                      <button
                        key={choice.id ?? 'host'}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={on ? 'psm-row is-on' : 'psm-row'}
                        data-testid={`phone-run-mode-${choice.id ?? 'host'}`}
                        disabled={props.disabled}
                        onClick={() => {
                          props.onChange(choice.id);
                          setOpen(false);
                        }}
                      >
                        <span className="psm-row-main">
                          <span className="psm-row-name">{choice.label}</span>
                          <span className="psm-row-meta">{choice.detail}</span>
                        </span>
                        {on ? (
                          <span className="psm-check" aria-hidden>
                            ✓
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {props.onOpenSettings ? (
                  <button
                    type="button"
                    className="psm-link"
                    onClick={() => {
                      setOpen(false);
                      props.onOpenSettings?.();
                    }}
                  >
                    {isZh ? '权限设置…' : 'Permission settings…'}
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
