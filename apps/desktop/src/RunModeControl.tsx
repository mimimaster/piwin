/**
 * Composer Run Mode pill (ADR 0024).
 *
 * Three-state popover for permission Run Mode: Ask / Auto / YOLO.
 * Session-level by default; "Set as default" writes config.permissions.preset.
 * Modeled on ThinkingEffortControl (upward popover, compact trigger).
 */
import { useState, type ReactElement } from "react";
import { Popover } from "@piwin/ui-kit";
import type { PermissionPreset } from "@piwin/contracts";
import { useDesktopLocale } from "./desktop-locale-context";

export type RunModeControlProps = {
  disabled: boolean;
  value: PermissionPreset;
  onChange: (preset: PermissionPreset) => void;
  /** Persist as default (writes config.permissions.preset). */
  onSetDefault?: (preset: PermissionPreset) => void;
  /** Open Settings → Permissions (rules, remembered list). */
  onOpenSettings?: () => void;
  /** YOLO is unavailable for untrusted projects. */
  yoloDisabled?: boolean;
};

type PresetDef = {
  id: PermissionPreset;
  label: string;
  zhLabel: string;
  description: string;
  zhDescription: string;
  warning?: boolean;
};

const PRESETS: readonly PresetDef[] = [
  {
    id: "auto",
    label: "Auto",
    zhLabel: "自动",
    description: "Sandboxed; asks to leave workspace or open network.",
    zhDescription: "沙箱内自动执行；离开项目或出网时询问",
  },
  {
    id: "ask",
    label: "Ask",
    zhLabel: "每次询问",
    description: "Asks before almost every tool call (still sandboxed).",
    zhDescription: "几乎每个工具都确认（仍在沙箱内）",
  },
  {
    id: "yolo",
    label: "YOLO",
    zhLabel: "放行",
    description: "No sandbox, no prompts. Circuit breakers still fire.",
    zhDescription: "关闭沙箱，跳过常规确认。危险操作仍会拦截。",
    warning: true,
  },
];

function presetLabel(preset: PermissionPreset, isZh: boolean): string {
  const def = PRESETS.find((p) => p.id === preset);
  return def ? (isZh ? def.zhLabel : def.label) : preset;
}

export function RunModeControl({
  disabled,
  value,
  onChange,
  onSetDefault,
  onOpenSettings,
  yoloDisabled,
}: RunModeControlProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === "zh-CN";
  const [open, setOpen] = useState(false);
  const isWarning = value === "yolo";

  return (
    <div
      className={isWarning ? "run-mode-control is-warning" : "run-mode-control"}
      data-mode={value}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        label={isZh ? "运行模式" : "Run mode"}
        testId="run-mode-popover"
        contentClassName="run-mode-popover"
        trigger={
          <button
            type="button"
            className="run-mode-trigger"
            disabled={disabled}
            aria-label={isZh ? `运行模式: ${presetLabel(value, isZh)}` : `Run mode: ${presetLabel(value, isZh)}`}
            data-testid="run-mode-trigger"
            data-mode={value}
          >
            <span className="run-mode-value">{presetLabel(value, isZh)}</span>
            <span className="run-mode-chevron" aria-hidden />
          </button>
        }
      >
        <div className="run-mode-section">
          <div className="run-mode-section-title">
            {isZh ? "运行模式" : "Run mode"}
          </div>
          {PRESETS.map((def) => {
            const isYoloDisabled = def.id === "yolo" && yoloDisabled;
            return (
              <button
                key={def.id}
                type="button"
                className={
                  value === def.id
                    ? "run-mode-option is-selected"
                    : "run-mode-option"
                }
                data-testid={`run-mode-option-${def.id}`}
                data-mode={def.id}
                disabled={isYoloDisabled}
                title={isYoloDisabled ? (isZh ? "未信任项目不可用" : "Unavailable for untrusted projects") : undefined}
                onClick={() => {
                  onChange(def.id);
                  setOpen(false);
                }}
              >
                <span className="run-mode-option-label">
                  {isZh ? def.zhLabel : def.label}
                </span>
                <span className="run-mode-option-desc">
                  {isZh ? def.zhDescription : def.description}
                </span>
                {def.warning && !isYoloDisabled ? (
                  <span className="run-mode-option-warning" aria-hidden>
                    ⚠
                  </span>
                ) : null}
                {isYoloDisabled ? (
                  <span className="run-mode-option-locked" aria-hidden>
                    🔒
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="run-mode-footer">
          {onSetDefault ? (
            <button
              type="button"
              className="run-mode-footer-btn"
              data-testid="run-mode-set-default"
              onClick={() => {
                onSetDefault(value);
              }}
            >
              {isZh ? "设为默认" : "Set as default"}
            </button>
          ) : null}
          {onOpenSettings ? (
            <button
              type="button"
              className="run-mode-footer-btn"
              data-testid="run-mode-open-settings"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              {isZh ? "管理规则…" : "Manage rules…"}
            </button>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
