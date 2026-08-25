/**
 * Local sidecar vs attached Host (D-CTX-01b).
 * This is not a cloud product: the second target is a Host already running
 * on another machine. Local stays available to switch back. Attach opens the
 * connect wall (stops the local Host when leaving the workbench).
 */
import type { ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@piwin/ui-kit';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { isDesktopShellOnlyBuild } from './desktop-shell-build';
import { IconChevronDown, IconLaptop, IconServer } from './shell-icons';

export type RuntimeTargetChipProps = {
  /** True when Desktop is attached to a saved standalone Host. */
  remoteConnected?: boolean;
  /** Hostname:port of the attached Host, when known. */
  hostLabel?: string;
  onSelectLocal?: () => void;
  /** Leave the local sidecar and open the attach connect wall. */
  onSelectAttach?: () => void;
};

export function RuntimeTargetChip(props: RuntimeTargetChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).composer;
  const shellOnly = isDesktopShellOnlyBuild();
  const remoteConnected = props.remoteConnected === true;
  const hostLabel = props.hostLabel?.trim() ?? '';
  const attachedLabel = hostLabel.length > 0 ? hostLabel : copy.runtimeAttachedLabel;
  const attachedTooltip = copy.runtimeAttachedTooltip(hostLabel.length > 0 ? hostLabel : null);
  const activeLabel = remoteConnected ? attachedLabel : copy.runtimeLocalLabel;
  const activeTooltip = remoteConnected ? attachedTooltip : copy.runtimeLocalTooltip;

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
            <IconServer width={13} height={13} className="composer-context-link-icon" />
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
        disabled={!remoteConnected || shellOnly}
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
      {remoteConnected ? (
        <DropdownMenuItem disabled testId="composer-runtime-remote-item">
          <span className="composer-context-menu-row" title={attachedTooltip}>
            <IconServer width={13} height={13} />
            <span>{`● ${attachedLabel}`}</span>
          </span>
        </DropdownMenuItem>
      ) : shellOnly ? null : (
        <DropdownMenuItem
          testId="composer-runtime-attach-item"
          onSelect={() => {
            props.onSelectAttach?.();
          }}
        >
          <span className="composer-context-menu-row">
            <IconServer width={13} height={13} />
            <span>{copy.runtimeAttachAction}</span>
          </span>
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
