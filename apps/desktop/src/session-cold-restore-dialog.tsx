import type { ReactElement } from 'react';
import type { SessionStorageInfo } from '@piwin/contracts';
import { Button, Dialog } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export function SessionColdRestoreDialog(props: {
  sessionId: string;
  storage: SessionStorageInfo;
  busy?: boolean;
  onCancel: () => void;
  onRestore: (packPath?: string) => void;
}): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const missing = props.storage.state === 'missing-pack';
  return (
    <Dialog
      label={isZh ? '先恢复会话' : 'Restore session first'}
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) {
          props.onCancel();
        }
      }}
      testId="session-cold-restore-dialog"
    >
      <div className="revert-modal-content">
        <h3 className="revert-modal-title">
          {isZh ? '需要先从包恢复' : 'Restore from pack before opening'}
        </h3>
        <p className="revert-modal-subtitle muted">
          {missing
            ? isZh
              ? '这个会话的包当前不可读。选择一个匹配的 .piwin-pack 后再打开。'
              : 'This session’s pack is missing or unreadable. Choose a matching .piwin-pack before opening it.'
            : isZh
              ? '这个会话已卸载到外部包。恢复后才能打开，不会创建空的本地 transcript。'
              : 'This session is offloaded. Restore it before opening so an empty local transcript is never created.'}
        </p>
        <p className="muted" data-testid="session-cold-restore-id">
          {props.sessionId}
        </p>
        <div className="revert-modal-footer">
          <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button
            data-testid="session-cold-restore-confirm"
            disabled={props.busy}
            onClick={() => props.onRestore()}
          >
            {missing
              ? isZh
                ? '选择包并恢复'
                : 'Choose pack and restore'
              : isZh
                ? '恢复并打开'
                : 'Restore and open'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
