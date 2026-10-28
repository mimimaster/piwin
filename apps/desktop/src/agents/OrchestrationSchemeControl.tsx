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
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { usePhoneShellLayout } from '../hooks/use-phone-shell-layout';
import {
  OrchestrationSchemeOptions,
  orchestrationSchemeLabel,
  selectedOrchestrationScheme,
  unpinnedSchemeHint,
  type OrchestrationSchemeOption,
} from './orchestration-scheme-options';

export type { OrchestrationSchemeOption } from './orchestration-scheme-options';

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
  const phone = usePhoneShellLayout();
  const isActive = value !== 'off' && value !== '';
  const selectedLabel = orchestrationSchemeLabel(selectedOrchestrationScheme(options, value), isZh);
  const unpinnedHint = unpinnedSchemeHint(options, value, isZh);

  return (
    <div className={isActive ? 'orchestration-scheme-control is-active' : 'orchestration-scheme-control'}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        presentation={phone ? 'sheet' : 'anchored'}
        label={isZh ? '编排方案' : 'Orchestration scheme'}
        testId="orchestration-scheme-popover"
        contentClassName="orchestration-scheme-popover"
        trigger={
          <button
            type="button"
            className="orchestration-scheme-trigger"
            disabled={disabled}
            {...(unpinnedHint ? { title: unpinnedHint } : {})}
            aria-label={isZh ? `编排方案: ${selectedLabel}` : `Orchestration scheme: ${selectedLabel}`}
            data-testid="orchestration-scheme-trigger"
            data-scheme={value || 'off'}
          >
            <span className="orchestration-scheme-value">{selectedLabel}</span>
            <span className="orchestration-scheme-chevron" aria-hidden />
          </button>
        }
      >
        <OrchestrationSchemeOptions
          isZh={isZh}
          value={value}
          options={options}
          onChange={onChange}
          delegationDisabled={delegationDisabled}
          onDelegationDisabledChange={onDelegationDisabledChange}
          onOpenSettings={onOpenSettings}
          onDone={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}
