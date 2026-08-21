/**
 * Explicit subtree delete confirmation (ADR 0055). Daily edit/regenerate
 * branches instead; this dialog is the only Desktop path to truncate-from.
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
      label={isChinese ? '删除此处及之后的消息？' : 'Delete this message and everything after it?'}
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
          {isChinese ? '删除此处及之后的消息？' : 'Delete this message and everything after it?'}
        </h3>
        <p className="revert-modal-subtitle muted">
          {isChinese
            ? '此分支上的后续消息会从对话里移除。磁盘上的文件改动不会撤销。'
            : 'Later messages on this branch will be removed from this chat. File changes on disk are not undone.'}
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
