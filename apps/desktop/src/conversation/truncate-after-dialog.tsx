/**
 * Explicit subtree delete confirmation (ADR 0055 / 0064). The only
 * Desktop path named Revert — daily retry/regenerate never truncate.
 */
import { Button, Dialog } from '@piwin/ui-kit';
import type { ReactElement } from 'react';

export type TruncateAfterDialogProps = {
  open: boolean;
  locale?: 'zh-CN' | 'en';
  onCancel: () => void;
  onConfirm: () => void;
};

export function TruncateAfterDialog(props: TruncateAfterDialogProps): ReactElement | null {
  if (!props.open) {
    return null;
  }
  const isChinese = props.locale !== 'en';
  return (
    <Dialog
      label={isChinese ? '回到此处？' : 'Revert to here?'}
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel();
        }
      }}
      testId="truncate-after-confirm"
    >
      <div className="revert-modal-content">
        <h3 className="revert-modal-title">
          {isChinese ? '回到此处？' : 'Revert to here?'}
        </h3>
        <p className="revert-modal-subtitle muted">
          {isChinese
            ? '这条之后的所有消息会被删除，不可恢复。磁盘上的文件改动不会撤销。'
            : 'Every message after this one will be deleted and cannot be restored. File changes on disk are not undone.'}
        </p>
        <div className="revert-modal-footer">
          <div className="modal-actions">
            <Button data-testid="truncate-after-cancel" onClick={props.onCancel}>
              {isChinese ? '取消' : 'Cancel'}
            </Button>
            <Button
              variant="danger"
              className="revert-continue-btn"
              data-testid="truncate-after-confirm"
              onClick={props.onConfirm}
            >
              {isChinese ? '删除' : 'Delete'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
