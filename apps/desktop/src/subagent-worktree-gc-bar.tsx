import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { HostResponse, SubagentWorktreeGcPreview } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { useConfirmDialog } from './use-confirm-dialog';

export type SubagentWorktreeGcRequest =
  | { type: 'subagent/worktree-gc-preview' }
  | { type: 'subagent/worktree-gc' };

function readPreview(response: HostResponse): SubagentWorktreeGcPreview | null {
  if (!response.success || !response.data || typeof response.data !== 'object') {
    return null;
  }
  const data = response.data as Partial<SubagentWorktreeGcPreview>;
  if (
    typeof data.totalBytes !== 'number' ||
    typeof data.reclaimableBytes !== 'number' ||
    typeof data.reclaimableCount !== 'number' ||
    !Array.isArray(data.entries)
  ) {
    return null;
  }
  return {
    entries: data.entries,
    totalBytes: data.totalBytes,
    reclaimableBytes: data.reclaimableBytes,
    reclaimableCount: data.reclaimableCount,
  };
}

function formatWorktreeBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function SubagentWorktreeGcBar(props: {
  request: (command: SubagentWorktreeGcRequest) => Promise<HostResponse>;
  isChinese: boolean;
}): ReactElement | null {
  const confirmDialog = useConfirmDialog();
  const [preview, setPreview] = useState<SubagentWorktreeGcPreview | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const request = props.request;
  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await request({ type: 'subagent/worktree-gc-preview' });
      setPreview(readPreview(response));
    } catch {
      setPreview(null);
    }
  }, [request]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const cleanup = useCallback(async (): Promise<void> => {
    if (!preview || preview.reclaimableCount === 0) return;
    const confirmed = await confirmDialog.confirm({
      title: props.isChinese ? '清理残留 worktree？' : 'Clean leftover worktrees?',
      description: props.isChinese
        ? `将删除 ${String(preview.reclaimableCount)} 个已结束且可安全回收的 worktree（约 ${formatWorktreeBytes(preview.reclaimableBytes)}）。待合入、冲突、已保留、暂停恢复点仍引用的不会动。`
        : `Remove ${String(preview.reclaimableCount)} finished worktrees that are safe to reclaim (about ${formatWorktreeBytes(preview.reclaimableBytes)}). Pending, conflicted, retained, and pause-checkpoint copies stay.`,
      confirmLabel: props.isChinese ? '清理' : 'Clean up',
      cancelLabel: props.isChinese ? '取消' : 'Cancel',
      tone: 'danger',
    });
    if (!confirmed) return;
    setCleaning(true);
    try {
      await request({ type: 'subagent/worktree-gc' });
      await reload();
    } finally {
      setCleaning(false);
    }
  }, [confirmDialog, preview, props.isChinese, request, reload]);

  if (!preview || preview.entries.length === 0) {
    return confirmDialog.dialog;
  }

  return (
    <div className="settings-section" data-testid="subagent-worktree-gc">
      <div className="subagent-tasks-batch-head">
        <h4 className="subagent-tasks-header">
          {props.isChinese
            ? `Worktree ${formatWorktreeBytes(preview.totalBytes)} · ${String(preview.reclaimableCount)} 可清理`
            : `Worktrees ${formatWorktreeBytes(preview.totalBytes)} · ${String(preview.reclaimableCount)} reclaimable`}
        </h4>
        <Button
          size="compact"
          variant="danger"
          disabled={cleaning || preview.reclaimableCount === 0}
          data-testid="subagent-worktree-gc-run"
          onClick={() => {
            void cleanup();
          }}
        >
          {cleaning
            ? props.isChinese
              ? '清理中…'
              : 'Cleaning…'
            : props.isChinese
              ? '清理'
              : 'Clean up'}
        </Button>
      </div>
      {confirmDialog.dialog}
    </div>
  );
}

