/**
 * Local / Remote Host runtime-target chip (D-CTX-01b).
 * Local is the default. Remote Host is enabled only when a saved target is
 * connected; Local stays available to switch back to the sidecar.
 */
import type { ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { IconChevronDown, IconCloud, IconLaptop } from './shell-icons';

export type RuntimeTargetChipProps = {
  /** True when Desktop is attached to a saved standalone Host. */
  remoteConnected?: boolean;
  onSelectLocal?: () => void;
};

export function RuntimeTargetChip(props: RuntimeTargetChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).composer;
  const remoteConnected = props.remoteConnected === true;
  const activeLabel = remoteConnected ? copy.runtimeCloudLabel : copy.runtimeLocalLabel;
  const activeTooltip = remoteConnected
    ? copy.runtimeCloudConnectedTooltip
    : copy.runtimeLocalTooltip;

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
          title={activeTooltip}
          aria-label={activeTooltip}
        >
          {remoteConnected ? (
            <IconCloud width={13} height={13} className="composer-context-link-icon" />
          ) : (
            <IconLaptop width={13} height={13} className="composer-context-link-icon" />
          )}
          <span
            className="composer-context-link-label"
            data-testid={remoteConnected ? 'composer-runtime-remote' : 'composer-runtime-local'}
          >
            {activeLabel}
          </span>
          <span className="composer-context-link-caret" aria-hidden>
            <IconChevronDown width={13} height={13} />
          </span>
        </button>
      }
    >
      <DropdownMenuItem
        disabled={!remoteConnected}
        testId="composer-runtime-local-item"
        onSelect={() => {
          props.onSelectLocal?.();
        }}
      >
        <span className="composer-context-menu-row">
          <IconLaptop width={13} height={13} />
          <span>
            {remoteConnected ? copy.runtimeLocalLabel : `● ${copy.runtimeLocalLabel}`}
          </span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!remoteConnected} testId="composer-runtime-remote-item">
        <span
          className={`composer-context-menu-row${remoteConnected ? '' : ' is-muted'}`}
          title={
            remoteConnected
              ? copy.runtimeCloudConnectedTooltip
              : copy.runtimeCloudDisconnectedTooltip
          }
        >
          <IconCloud width={13} height={13} />
          <span>{remoteConnected ? `● ${copy.runtimeCloudLabel}` : copy.runtimeCloudLabel}</span>
          {!remoteConnected ? (
            <span className="composer-context-menu-hint">
              {copy.runtimeCloudDisconnectedTooltip}
            </span>
          ) : null}
        </span>
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
