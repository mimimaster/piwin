/**
 * Workspace changes (the Git working tree) with the 更多 menu whose one
 * entry is the undo fallback, 代码撤销记录. The Changes list itself is
 * unchanged and gains no undo powers from sitting here.
 */
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import { DropdownMenu, DropdownMenuItem, IconButton } from '@piwin/ui-kit';
import { IconMore } from '../shell-icons.js';
import { TurnChangeRecordDialog } from './turn-change-record-dialog.js';
import { pickProjectDirectory } from '../pick-project-directory.js';

export type WorkspaceChangesSectionProps = {
  hostClient: {
    supportsCommand: (type: HostCommand['type']) => boolean;
    request: (command: HostCommand, options?: { idempotencyKey?: string }) => Promise<HostResponse>;
    /** `live` = the Host sidecar on this machine; only then can a local folder picker name a Host path. */
    getTransport?: () => string;
  };
  subscribePush?: (listener: (message: HostPush) => void) => () => void;
  projectPath: string | null;
  locale: 'zh-CN' | 'en';
  turnChangesSupported: boolean;
  children: ReactNode;
};

export function WorkspaceChangesSection(props: WorkspaceChangesSectionProps): ReactElement {
  const { hostClient } = props;
  const [recordOpen, setRecordOpen] = useState(false);
  const t = (zh: string, en: string): string => (props.locale === 'en' ? en : zh);
  const showRecord =
    props.turnChangesSupported &&
    props.projectPath !== null &&
    hostClient.supportsCommand('turn-changes/operations');
  const request = useCallback(
    (command: HostCommand, options?: { idempotencyKey?: string }) => hostClient.request(command, options),
    [hostClient],
  );
  const subscribe = props.subscribePush;
  const subscribePush = useCallback(
    (listener: (push: HostPush) => void) => subscribe?.(listener) ?? (() => undefined),
    [subscribe],
  );

  return (
    <div className="workspace-changes-section" data-testid="workspace-changes-section">
      {showRecord ? (
        <div className="workspace-changes-more">
          <DropdownMenu
            align="end"
            label={t('更多', 'More')}
            testId="workspace-changes-more-menu"
            trigger={
              <IconButton label={t('更多', 'More')} size={26} data-testid="workspace-changes-more">
                <IconMore width={15} height={15} />
              </IconButton>
            }
          >
            <DropdownMenuItem onSelect={() => setRecordOpen(true)} testId="workspace-changes-undo-record">
              {t('代码撤销记录', 'Undo history')}
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      ) : null}
      {props.children}
      {showRecord ? (
        <TurnChangeRecordDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          projectPath={props.projectPath}
          request={request}
          subscribePush={subscribePush}
          locale={props.locale}
          {...(hostClient.getTransport?.() === 'live'
            ? { pickDirectory: () => pickProjectDirectory({ title: t('选择导出位置', 'Choose export location') }) }
            : {})}
        />
      ) : null}
    </div>
  );
}
