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
import { useDesktopLocale } from "../i18n/desktop-locale-context";
import { usePhoneShellLayout } from "../hooks/use-phone-shell-layout";
import { RunModeOptions, runModeLabel } from "./run-mode-options";

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
  const phone = usePhoneShellLayout();
  const isWarning = value === "yolo";
  const label = runModeLabel(value, isZh);

  return (
    <div className={isWarning ? "run-mode-control is-warning" : "run-mode-control"} data-mode={value}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        presentation={phone ? "sheet" : "anchored"}
        label={isZh ? "运行模式" : "Run mode"}
        testId="run-mode-popover"
        contentClassName="run-mode-popover"
        trigger={
          <button
            type="button"
            className="run-mode-trigger"
            disabled={disabled}
            aria-label={isZh ? `运行模式: ${label}` : `Run mode: ${label}`}
            data-testid="run-mode-trigger"
            data-mode={value}
          >
            <span className="run-mode-value">{label}</span>
            <span className="run-mode-chevron" aria-hidden />
          </button>
        }
      >
        <RunModeOptions
          isZh={isZh}
          value={value}
          onChange={onChange}
          onSetDefault={onSetDefault}
          onOpenSettings={onOpenSettings}
          yoloDisabled={yoloDisabled}
          onDone={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}
