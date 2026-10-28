/**
 * Phone composer: run mode and orchestration share one pill and one sheet.
 * Side by side they took two pills of a single toolbar row and squeezed the
 * model name to a few letters; both are "how this turn runs", so one tap
 * opens both sections. Desktop keeps the two pills.
 */
import { useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { PermissionPreset } from '@piwin/contracts';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { RunModeOptions, runModeLabel } from '../run-activity/run-mode-options';
import {
  OrchestrationSchemeOptions,
  orchestrationSchemeLabel,
  selectedOrchestrationScheme,
  type OrchestrationSchemeOption,
} from '../agents/orchestration-scheme-options';

export type ComposerModeControlProps = {
  /** A turn is running: run mode is read-only until it ends. */
  runDisabled: boolean;
  runMode: PermissionPreset;
  onRunModeChange: (preset: PermissionPreset) => void;
  onRunModeSetDefault?: ((preset: PermissionPreset) => void) | undefined;
  onOpenPermissionsSettings?: (() => void) | undefined;
  yoloDisabled?: boolean | undefined;
  schemeId: string;
  schemeOptions: readonly OrchestrationSchemeOption[];
  onSchemeChange: (schemeId: string) => void;
  delegationDisabled: boolean;
  onDelegationDisabledChange?: ((disabled: boolean) => void) | undefined;
  onOpenSchemeSettings?: (() => void) | undefined;
};

export function ComposerModeControl(props: ComposerModeControlProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const runLabel = runModeLabel(props.runMode, isZh);
  const schemeLabel = orchestrationSchemeLabel(
    selectedOrchestrationScheme(props.schemeOptions, props.schemeId),
    isZh,
  );
  const close = (): void => setOpen(false);

  return (
    <div
      className={props.runMode === 'yolo' ? 'run-mode-control composer-mode-control is-warning' : 'run-mode-control composer-mode-control'}
      data-mode={props.runMode}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        presentation="sheet"
        label={isZh ? '运行方式' : 'How this turn runs'}
        testId="composer-mode-popover"
        contentClassName="run-mode-popover orchestration-scheme-popover composer-mode-popover"
        trigger={
          <button
            type="button"
            className="run-mode-trigger composer-mode-trigger"
            aria-label={
              isZh
                ? `运行模式: ${runLabel}，编排方案: ${schemeLabel}`
                : `Run mode: ${runLabel}, orchestration: ${schemeLabel}`
            }
            data-testid="composer-mode-trigger"
          >
            <span className="run-mode-value">{runLabel}</span>
            <span className="composer-mode-sep" aria-hidden>
              ·
            </span>
            <span className="composer-mode-scheme">{schemeLabel}</span>
          </button>
        }
      >
        <RunModeOptions
          isZh={isZh}
          value={props.runMode}
          onChange={props.onRunModeChange}
          onSetDefault={props.onRunModeSetDefault}
          onOpenSettings={props.onOpenPermissionsSettings}
          yoloDisabled={props.yoloDisabled}
          disabled={props.runDisabled}
          onDone={close}
        />
        <OrchestrationSchemeOptions
          isZh={isZh}
          value={props.schemeId}
          options={props.schemeOptions}
          onChange={props.onSchemeChange}
          delegationDisabled={props.delegationDisabled}
          onDelegationDisabledChange={props.onDelegationDisabledChange}
          onOpenSettings={props.onOpenSchemeSettings}
          onDone={close}
        />
      </Popover>
    </div>
  );
}
