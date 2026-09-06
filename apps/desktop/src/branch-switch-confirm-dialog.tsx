/**
 * Write-boundary confirm for conversation-tree switch (ADR 0055 Stage 5).
 * Continue / cancel, plus stash-then-switch when the caller wires it.
 */
import { Button, Dialog } from '@piwin/ui-kit';
import type { WorkspaceWrites } from '@piwin/contracts';
import type { ReactElement } from 'react';

const MAX_LISTED_FILES = 12;

export type BranchSwitchConfirmDialogProps = {
  open: boolean;
  locale?: 'zh-CN' | 'en';
  /** Retry discard reuses the write list; copy names the attempt, not a switch. */
  intent?: 'switch' | 'discard-attempt';
  offPathWrites: WorkspaceWrites | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Stash workspace writes then switch (ADR 0055 SF-06). Hidden for retry discard. */
  onStashThenSwitch?: () => void;
};

export function BranchSwitchConfirmDialog(
  props: BranchSwitchConfirmDialogProps,
): ReactElement | null {
  if (!props.open) {
    return null;
  }
  const isChinese = props.locale !== 'en';
  const discard = props.intent === 'discard-attempt';
  const files = props.offPathWrites?.files ?? [];
  const unknown = props.offPathWrites?.hasUnknownWrites === true;
  const title = discard
    ? isChinese
      ? '重试会丢掉这次尝试？磁盘不会跟随'
      : 'Retry will discard this attempt? Disk will not follow'
    : isChinese
      ? '切换分支？磁盘不会跟随'
      : 'Switch branch? Disk will not follow';
  return (
    <Dialog
      label={title}
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel();
        }
      }}
      testId="branch-switch-confirm"
    >
      <div className="revert-modal-content">
        <h3 className="revert-modal-title">{title}</h3>
        <p className="revert-modal-subtitle muted">
          {discard
            ? isChinese
              ? '这次尝试改过工作区文件。重试会从对话里删掉它；磁盘上的改动不会撤销。'
              : 'This attempt wrote workspace files. Retry removes it from the chat; file changes on disk are not undone.'
            : isChinese
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
            {!discard && props.onStashThenSwitch ? (
              <Button
                data-testid="branch-switch-stash"
                onClick={props.onStashThenSwitch}
              >
                {isChinese ? '先暂存再切换' : 'Stash then switch'}
              </Button>
            ) : null}
            <Button
              className="revert-continue-btn"
              data-testid="branch-switch-continue"
              onClick={props.onConfirm}
            >
              {discard
                ? isChinese
                  ? '仍然重试'
                  : 'Retry anyway'
                : isChinese
                  ? '继续切换'
                  : 'Switch anyway'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
