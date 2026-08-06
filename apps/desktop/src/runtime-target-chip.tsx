/**
 * Honest Local / Cloud runtime-target stub (backlog D-CTX-01a).
 * Plain-text dropdown above the composer: Local is active; Cloud is grey and
 * not selectable until a personal remote gateway is connected.
 */
import type { ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { IconCloud, IconLaptop } from './shell-icons';

export type RuntimeTargetChipProps = {
  /**
   * When true, Cloud becomes enabled. v0 always leaves this false/undefined;
   * wired later when personal gateway reports connected (D-CTX-01b).
   */
  cloudConnected?: boolean;
};

export function RuntimeTargetChip(props: RuntimeTargetChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).composer;
  const cloudConnected = props.cloudConnected === true;

  return (
    <DropdownMenu
      modal={false}
      align="start"
      side="bottom"
      contentClassName="composer-context-menu"
      testId="composer-runtime-menu"
      label={copy.runtimeTargetGroupLabel}
      trigger={
        <button
          type="button"
          className="composer-context-link"
          data-testid="composer-runtime-target"
          title={copy.runtimeLocalTooltip}
          aria-label={copy.runtimeLocalTooltip}
        >
          <IconLaptop width={13} height={13} className="composer-context-link-icon" />
          <span className="composer-context-link-label" data-testid="composer-runtime-local">
            {copy.runtimeLocalLabel}
          </span>
          <span className="composer-context-link-caret" aria-hidden>
            ▾
          </span>
        </button>
      }
    >
      <DropdownMenuItem disabled testId="composer-runtime-local-item">
        <span className="composer-context-menu-row">
          <IconLaptop width={13} height={13} />
          <span>● {copy.runtimeLocalLabel}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!cloudConnected}
        testId="composer-runtime-cloud"
        onSelect={() => {
          // v0: Cloud stays non-selectable while disconnected.
        }}
      >
        <span
          className={`composer-context-menu-row${cloudConnected ? '' : ' is-muted'}`}
          title={
            cloudConnected
              ? copy.runtimeCloudConnectedTooltip
              : copy.runtimeCloudDisconnectedTooltip
          }
        >
          <IconCloud width={13} height={13} />
          <span>{copy.runtimeCloudLabel}</span>
          {!cloudConnected ? (
            <span className="composer-context-menu-hint">
              {copy.runtimeCloudDisconnectedTooltip}
            </span>
          ) : null}
        </span>
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
