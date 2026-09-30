/**
 * 代码撤销记录 — the fallback entry under Changes → 更多. Lists this
 * workspace's undo/redo operations, newest first. A detail view shows the
 * result, lets the user restore what an undo removed (only while that undo is
 * still the turn's latest), and walks a stuck operation through repair.
 *
 * Normal use never needs this: undo and 恢复改动 live on the turn card.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { HostPush, TurnChangeOperationEntry } from '@piwin/contracts';
import { Button, Dialog, Notice, StatusBadge, type StatusTone } from '@piwin/ui-kit';
import { createIdempotencyKey } from '@piwin/host-client';
import {
  useTurnChangeRecord,
  useTurnChangeRepair,
  type TurnChangeRecordRequest,
} from './use-turn-change-record.js';
import { TurnChangeBackupExportPanel } from './turn-change-backup-export.js';

type Copy = (zh: string, en: string) => string;

const STATUS_TONE: Record<TurnChangeOperationEntry['status'], StatusTone> = {
  applying: 'running',
  succeeded: 'success',
  rejected: 'warning',
  cancelled: 'neutral',
  'rolled-back': 'neutral',
  'needs-repair': 'danger',
};

function statusLabel(entry: TurnChangeOperationEntry, t: Copy): string {
  switch (entry.status) {
    case 'applying':
      return t('进行中', 'In progress');
    case 'succeeded':
      return t('已完成', 'Done');
    case 'rejected':
      return entry.reason === 'files-changed' ? t('文件已变化，未执行', 'Files changed; not applied') : t('未执行', 'Not applied');
    case 'cancelled':
      return t('已取消', 'Cancelled');
    case 'rolled-back':
      return entry.reason === 'repaired' ? t('已修复', 'Repaired') : t('失败，已回退', 'Failed; rolled back');
    case 'needs-repair':
      return t('需要修复', 'Needs repair');
  }
}

function formatTime(iso: string | null, locale: 'zh-CN' | 'en'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale);
}

export type TurnChangeRecordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string | null;
  request: TurnChangeRecordRequest;
  subscribePush: (listener: (push: HostPush) => void) => () => void;
  locale: 'zh-CN' | 'en';
  /** Only when the Host runs on this machine: a folder picker for 导出备份. */
  pickDirectory?: (() => Promise<string | null>) | undefined;
};

export function TurnChangeRecordDialog(props: TurnChangeRecordDialogProps): ReactElement {
  const t: Copy = (zh, en) => (props.locale === 'en' ? en : zh);
  const record = useTurnChangeRecord({
    request: props.request,
    subscribePush: props.subscribePush,
    projectPath: props.projectPath,
    enabled: props.open,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => record.operations.find((entry) => entry.operationId === selectedId) ?? null,
    [record.operations, selectedId],
  );

  return (
    <Dialog
      label={t('代码撤销记录', 'Undo history')}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setSelectedId(null);
        props.onOpenChange(open);
      }}
      closeOnInteractOutside
      contentClassName="turn-change-record"
      testId="turn-change-record"
    >
      <h3>{t('代码撤销记录', 'Undo history')}</h3>
      {selected ? (
        <OperationDetail
          entry={selected}
          request={props.request}
          pickDirectory={props.pickDirectory}
          locale={props.locale}
          t={t}
          onBack={() => setSelectedId(null)}
          onChanged={record.reload}
        />
      ) : (
        <OperationList
          state={record}
          locale={props.locale}
          t={t}
          onSelect={setSelectedId}
        />
      )}
      <div className="modal-actions">
        <Button data-testid="turn-change-record-close" onClick={() => props.onOpenChange(false)}>
          {t('关闭', 'Close')}
        </Button>
      </div>
    </Dialog>
  );
}

function OperationList(props: {
  state: ReturnType<typeof useTurnChangeRecord>;
  locale: 'zh-CN' | 'en';
  t: Copy;
  onSelect: (operationId: string) => void;
}): ReactElement {
  const { state, t } = props;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (state.operations.length === 0) {
    return (
      <p className="muted" data-testid="turn-change-record-empty">
        {state.loading
          ? t('加载中…', 'Loading…')
          : t('这个工作区还没有撤销或恢复记录。', 'No undo or restore in this workspace yet.')}
      </p>
    );
  }
  return (
    <>
      <ul className="turn-change-record-list" data-testid="turn-change-record-list">
        {state.operations.map((entry) => (
          <li key={entry.operationId}>
            <button
              type="button"
              className="turn-change-record-row"
              onClick={() => props.onSelect(entry.operationId)}
              data-testid="turn-change-record-row"
              data-status={entry.status}
            >
              <span className="turn-change-record-row-main">
                <span className="turn-change-record-row-title">
                  {entry.direction === 'undo' ? t('撤销', 'Undo') : t('恢复改动', 'Restore')}
                  {' · '}
                  {t(`${entry.fileCount} 个文件`, `${entry.fileCount} files`)}
                </span>
                <span className="turn-change-record-row-time muted">{formatTime(entry.createdAt, props.locale)}</span>
              </span>
              <StatusBadge tone={STATUS_TONE[entry.status]} label={statusLabel(entry, t)} />
            </button>
          </li>
        ))}
      </ul>
      {state.hasMore ? (
        <Button size="compact" disabled={state.loading} onClick={state.loadMore} data-testid="turn-change-record-more">
          {t('加载更多', 'Load more')}
        </Button>
      ) : null}
    </>
  );
}

function OperationDetail(props: {
  entry: TurnChangeOperationEntry;
  request: TurnChangeRecordRequest;
  pickDirectory?: (() => Promise<string | null>) | undefined;
  locale: 'zh-CN' | 'en';
  t: Copy;
  onBack: () => void;
  onChanged: () => void;
}): ReactElement {
  const { entry, t } = props;
  const repair = useTurnChangeRepair(props.request, entry);
  const [restore, setRestore] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const summary = entry.summary;
  // Only the latest successful undo of a turn may be restored; older ones are read-only.
  const canRestore =
    entry.direction === 'undo' &&
    entry.status === 'succeeded' &&
    !entry.superseded &&
    summary?.disposition === 'undone' &&
    summary.redo.allowed;

  const runRestore = async (): Promise<void> => {
    if (!summary) return;
    setRestore({ busy: true, message: null });
    const response = await props.request(
      { type: 'turn-changes/redo', changeSetId: summary.changeSetId, expectedRevision: summary.revision },
      { idempotencyKey: createIdempotencyKey() },
    );
    const data = response.success ? (response.data as { status?: string; affectedPaths?: string[] }) : null;
    setRestore({
      busy: false,
      message:
        data?.status === 'succeeded'
          ? t('已恢复这次撤掉的改动。', 'The undone changes are back.')
          : data
            ? t(
                `无法恢复：${(data.affectedPaths ?? []).join('、') || '文件'}在撤销后又被修改，未修改任何文件。`,
                `Cannot restore: ${(data.affectedPaths ?? []).join(', ') || 'files'} changed after the undo. Nothing was modified.`,
              )
            : response.success
              ? null
              : response.error,
    });
    props.onChanged();
  };

  return (
    <div className="turn-change-record-detail" data-testid="turn-change-record-detail">
      <dl className="turn-change-record-facts">
        <dt>{t('操作', 'Action')}</dt>
        <dd>{entry.direction === 'undo' ? t('撤销本轮改动', 'Undo turn') : t('恢复本轮改动', 'Restore turn')}</dd>
        <dt>{t('结果', 'Result')}</dt>
        <dd>
          <StatusBadge tone={STATUS_TONE[entry.status]} label={statusLabel(entry, t)} />
        </dd>
        <dt>{t('时间', 'Time')}</dt>
        <dd>{formatTime(entry.createdAt, props.locale)}</dd>
        <dt>{t('文件', 'Files')}</dt>
        <dd>{entry.fileCount}</dd>
        {summary?.expiresAt ? (
          <>
            <dt>{t('保留至', 'Kept until')}</dt>
            <dd>{formatTime(summary.expiresAt, props.locale)}</dd>
          </>
        ) : null}
      </dl>
      {entry.superseded ? (
        <p className="muted">{t('这次操作已被之后的撤销/恢复替代，仅供查看。', 'A later undo/restore replaced this one; read only.')}</p>
      ) : null}
      {summary === null ? (
        <p className="muted">{t('来源轮次无法定位。', 'The source turn can no longer be found.')}</p>
      ) : summary.captureState === 'expired' ? (
        <p className="muted">{t('本轮没有可用的撤销数据（已过保留期）。', 'Undo data for this turn has expired.')}</p>
      ) : null}

      {entry.status === 'needs-repair' ? (
        <>
          <RepairSection repair={repair} t={t} onDone={props.onChanged} />
          <TurnChangeBackupExportPanel
            operationId={entry.operationId}
            request={props.request}
            pickDirectory={props.pickDirectory}
            t={t}
          />
        </>
      ) : null}
      {restore.message ? <Notice tone="info">{restore.message}</Notice> : null}

      <div className="turn-change-record-detail-actions">
        <Button size="compact" onClick={props.onBack} data-testid="turn-change-record-back">
          {t('返回记录列表', 'Back to list')}
        </Button>
        {canRestore ? (
          <Button
            size="compact"
            variant="primary"
            disabled={restore.busy}
            onClick={() => void runRestore()}
            data-testid="turn-change-record-restore"
          >
            {restore.busy ? t('正在恢复…', 'Restoring…') : t('恢复这次撤掉的改动', 'Restore these changes')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RepairSection(props: {
  repair: ReturnType<typeof useTurnChangeRepair>;
  t: Copy;
  onDone: () => void;
}): ReactElement {
  const { repair, t } = props;
  const step = repair.step;
  const preview = step.kind === 'preview' || step.kind === 'foreign' ? step.preview : null;
  const stateLabel = (state: 'restored' | 'operation-content' | 'foreign'): string =>
    state === 'restored'
      ? t('已是操作前内容', 'Back to before')
      : state === 'operation-content'
        ? t('将恢复为操作前内容', 'Will be restored')
        : t('内容来自别处，不会覆盖', 'Changed elsewhere; left alone');
  return (
    <section className="turn-change-record-repair" data-testid="turn-change-record-repair">
      <Notice tone="error">
        {t(
          '这次操作中途失败且未能自动回退。修复只把仍是本次写入内容的文件恢复为操作前内容；别处改过的文件不会被覆盖。',
          'This operation failed midway and could not roll back. Repair restores only files that still hold what it wrote; files changed elsewhere are never overwritten.',
        )}
      </Notice>
      {step.kind === 'loading' || step.kind === 'repairing' ? <p className="muted">{t('处理中…', 'Working…')}</p> : null}
      {step.kind === 'error' ? <Notice tone="error">{step.message}</Notice> : null}
      {step.kind === 'done' ? <Notice tone="info">{t('已修复，所有文件都回到了操作前内容。', 'Repaired: every file is back to before.')}</Notice> : null}
      {step.kind === 'foreign' ? (
        <Notice tone="warning">
          {t('仍有文件被别处修改，请手动处理后点「重新检查」。', 'Some files were changed elsewhere; resolve them by hand, then check again.')}
        </Notice>
      ) : null}
      {preview ? (
        <ul className="turn-change-record-repair-files">
          {preview.files.map((file) => (
            <li key={file.relativePath} data-state={file.state}>
              <code>{file.relativePath}</code>
              <span className="muted">{stateLabel(file.state)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="turn-change-record-detail-actions">
        <Button size="compact" onClick={() => void repair.preview()} data-testid="turn-change-record-recheck">
          {t('重新检查', 'Check again')}
        </Button>
        {step.kind === 'preview' ? (
          <Button
            size="compact"
            variant="danger"
            onClick={() => void repair.repair().then(props.onDone)}
            data-testid="turn-change-record-repair-run"
          >
            {t('确认修复', 'Repair')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
