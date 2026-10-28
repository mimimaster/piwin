/**
 * The run mode picker's body: the three presets plus set-default / rules.
 * Shared by the composer pill and the phone's combined mode sheet.
 */
import type { ReactElement } from "react";
import type { PermissionPreset } from "@piwin/contracts";

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

export function runModeLabel(preset: PermissionPreset, isZh: boolean): string {
  const def = PRESETS.find((p) => p.id === preset);
  return def ? (isZh ? def.zhLabel : def.label) : preset;
}

export type RunModeOptionsProps = {
  isZh: boolean;
  value: PermissionPreset;
  onChange: (preset: PermissionPreset) => void;
  onSetDefault?: ((preset: PermissionPreset) => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  yoloDisabled?: boolean | undefined;
  /** A turn is running: the preset is shown but cannot change. */
  disabled?: boolean | undefined;
  /** The surrounding popover closes after a pick or a jump to settings. */
  onDone: () => void;
};

export function RunModeOptions(props: RunModeOptionsProps): ReactElement {
  const { isZh, value, onChange, onSetDefault, onOpenSettings, yoloDisabled, disabled, onDone } = props;
  return (
    <>
      <div className="run-mode-section">
        <div className="run-mode-section-title">{isZh ? "运行模式" : "Run mode"}</div>
        {PRESETS.map((def) => {
          const isYoloDisabled = def.id === "yolo" && yoloDisabled === true;
          return (
            <button
              key={def.id}
              type="button"
              className={value === def.id ? "run-mode-option is-selected" : "run-mode-option"}
              data-testid={`run-mode-option-${def.id}`}
              data-mode={def.id}
              disabled={isYoloDisabled || disabled === true}
              title={isYoloDisabled ? (isZh ? "未信任项目不可用" : "Unavailable for untrusted projects") : undefined}
              onClick={() => {
                onChange(def.id);
                onDone();
              }}
            >
              <span className="run-mode-option-label">{isZh ? def.zhLabel : def.label}</span>
              <span className="run-mode-option-desc">{isZh ? def.zhDescription : def.description}</span>
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
              onDone();
              onOpenSettings();
            }}
          >
            {isZh ? "管理规则…" : "Manage rules…"}
          </button>
        ) : null}
      </div>
    </>
  );
}
