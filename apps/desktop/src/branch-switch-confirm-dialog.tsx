/**
 * Write-boundary confirm for conversation-tree switch (ADR 0055 Stage 5).
 * Two options only — worktree upgrade waits on SF-06.
 */
import { Button, Dialog } from '@piwin/ui-kit';
import type { WorkspaceWrites } from '@piwin/contracts';
import type { ReactElement } from 'react';

const MAX_LISTED_FILES = 12;

export type BranchSwitchConfirmDialogProps = {
  open: boolean;
  locale?: 'zh-CN' | 'en';
  offPathWrites: WorkspaceWrites | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BranchSwitchConfirmDialog(
  props: BranchSwitchConfirmDialogProps,
): ReactElement | null {
  if (!props.open) {
    return null;
  }
  const isChinese = props.locale !== 'en';
  const files = props.offPathWrites?.files ?? [];
  const unknown = props.offPathWrites?.hasUnknownWrites === true;
  return (
    <Dialog
      label={isChinese ? '切换分支？磁盘不会跟随' : 'Switch branch? Disk will not follow'}
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel();
        }
      }}
      testId="branch-switch-confirm"
    >
      <div className="revert-modal-content">
        <h3 className="revert-modal-title">
          {isChinese ? '切换分支？磁盘不会跟随' : 'Switch branch? Disk will not follow'}
        </h3>
        <p className="revert-modal-subtitle muted">
          {isChinese
            ? '当前分支改过工作区文件。对话会切到另一条时间线，磁盘上的改动不会撤销。'
            : 'The current branch wrote workspace files. The chat will move to the other timeline; file changes on disk are not undone.'}
        </p>
        {files.length > 0 ? (
          <ul className="branch-switch-write-list">
            {files.slice(0, MAX_LISTED_FILES).map((file) => (
              <li key={file}>{file}</li>
            ))}
            {files.length > MAX_LISTED_FILES ? (
              <li className="muted">
                {isChinese
                  ? `还有 ${files.length - MAX_LISTED_FILES} 个文件`
                  : `+${files.length - MAX_LISTED_FILES} more`}
              </li>
            ) : null}
          </ul>
        ) : null}
        {unknown ? (
          <p className="revert-modal-subtitle muted">
            {isChinese
              ? '还有未能解析路径的写操作（例如 shell）。'
              : 'Unknown writes were also recorded (for example a shell command).'}
          </p>
        ) : null}
        <div className="revert-modal-footer">
          <div className="modal-actions">
            <Button data-testid="branch-switch-cancel" onClick={props.onCancel}>
              {isChinese ? '取消' : 'Cancel'}
            </Button>
            <Button
              className="revert-continue-btn"
              data-testid="branch-switch-continue"
              onClick={props.onConfirm}
            >
              {isChinese ? '继续切换' : 'Switch anyway'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
