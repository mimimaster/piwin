/**
 * 导出备份 for a stuck undo/redo: copy its pre-operation backup to a new
 * directory on the Host machine. The path is where the Host runs; a local
 * Host can use the system folder picker, a remote one takes a typed path.
 * Nothing in the workspace is touched.
 */
import { useState, type ReactElement } from 'react';
import type { TurnChangeBackupExport } from '@piwin/contracts';
import { createIdempotencyKey } from '@piwin/host-client';
import { Button, Notice, TextInput } from '@piwin/ui-kit';

import type { TurnChangeRecordRequest } from './use-turn-change-record.js';

type Copy = (zh: string, en: string) => string;

const REFUSAL_COPY: Record<string, [string, string]> = {
  'destination-not-absolute': ['请填写完整的绝对路径。', 'Enter a full absolute path.'],
  'destination-missing': ['这个目录不存在。', 'That directory does not exist.'],
  'destination-inside-workspace': ['请选择工作区以外的目录。', 'Choose a directory outside the workspace.'],
  'destination-exists': ['那里已经有这次操作的导出，未覆盖。', 'An export of this operation is already there; nothing was overwritten.'],
  'backup-missing': ['这次操作的备份已不可用。', 'This operation’s backup is no longer available.'],
};

export function TurnChangeBackupExportPanel(props: {
  operationId: string;
  request: TurnChangeRecordRequest;
  /** Local Host only: the system folder picker. */
  pickDirectory?: (() => Promise<string | null>) | undefined;
  t: Copy;
}): ReactElement {
  const { t } = props;
  const [destination, setDestination] = useState('');
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; result: TurnChangeBackupExport } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const exportTo = async (target: string): Promise<void> => {
    setState({ kind: 'busy' });
    const response = await props.request(
      { type: 'turn-changes/export-backup', operationId: props.operationId, destination: target },
      { idempotencyKey: createIdempotencyKey() },
    );
    if (response.success) {
      setState({ kind: 'done', result: response.data as TurnChangeBackupExport });
      return;
    }
    const code = response.problem?.code;
    const copy = code ? REFUSAL_COPY[code] : undefined;
    setState({ kind: 'error', message: copy ? t(...copy) : response.error });
  };

  const pick = async (): Promise<void> => {
    const chosen = await props.pickDirectory?.();
    if (chosen) {
      setDestination(chosen);
      await exportTo(chosen);
    }
  };

  return (
    <div className="turn-change-record-export" data-testid="turn-change-record-export">
      <div className="turn-change-record-export-row">
        <TextInput
          toolbar
          value={destination}
          onChange={(event) => setDestination(event.currentTarget.value)}
          placeholder={t('Host 上的目录（绝对路径）', 'Directory on the Host (absolute path)')}
          aria-label={t('导出到的目录', 'Export to directory')}
          testId="turn-change-record-export-path"
        />
        {props.pickDirectory ? (
          <Button size="compact" onClick={() => void pick()} disabled={state.kind === 'busy'}>
            {t('选择…', 'Choose…')}
          </Button>
        ) : null}
        <Button
          size="compact"
          onClick={() => void exportTo(destination.trim())}
          disabled={state.kind === 'busy' || destination.trim().length === 0}
          data-testid="turn-change-record-export-run"
        >
          {state.kind === 'busy' ? t('正在导出…', 'Exporting…') : t('导出备份', 'Export backup')}
        </Button>
      </div>
      {state.kind === 'done' ? (
        <Notice tone="info">
          {t(
            `已导出 ${state.result.exportedPaths.length} 个文件到 ${state.result.destination}`,
            `Exported ${state.result.exportedPaths.length} files to ${state.result.destination}`,
          )}
        </Notice>
      ) : null}
      {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
    </div>
  );
}
