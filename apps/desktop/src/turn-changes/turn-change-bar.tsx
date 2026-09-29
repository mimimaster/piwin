/**
 * The turn's change summary with one-click undo / redo, from the Host's
 * sealed record (not the Git working tree). Replaces the per-call summary
 * bar whenever the turn has a record.
 *
 * States follow the product spec: recording → 本轮修改 N 个文件 [撤销] →
 * 本轮已撤销 [恢复改动]; incomplete records and conflicts say why and never
 * offer a forced overwrite.
 */
import { useCallback, useState, type ReactElement } from 'react';
import type {
  TurnChangeFileDiff,
  TurnChangeFileEntry,
  TurnChangeIncompleteReason,
  TurnChangeSummary,
} from '@piwin/contracts';
import { DiffCard, type DiffCardRequest } from '../diff-card';
import { changeStatusTag, formatDisplayPathParts, LineStat } from '../files-changed-bar';
import { IconGit } from '../shell-icons.js';
import type { TurnChangeActionResult, TurnChangesApi } from './turn-changes-context.js';

type Copy = (zh: string, en: string) => string;

const INCOMPLETE_COPY: Record<TurnChangeIncompleteReason, [string, string]> = {
  'command-overlap': ['有命令也修改了本轮改过的文件', 'a command also changed a file this turn edited'],
  'command-unaudited': ['有命令的改动无法核实', "a command's changes could not be verified"],
  'chain-broken': ['文件在本轮中途被其他来源修改', 'a file was changed by something else mid-turn'],
  'capture-failed': ['有写入未能记录', 'a write could not be recorded'],
  'capture-timeout': ['记录结束时仍有工具未完成', 'a tool was still running when recording ended'],
};

/** DiffCard only fetches when it has no `change`; the bar always passes one. */
const unusedDiffRequest: DiffCardRequest = () =>
  Promise.resolve({
    type: 'response',
    command: 'git/diff-file',
    success: false,
    error: 'not used',
  });

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; direction: 'undo' | 'redo' }
  | { kind: 'conflict'; direction: 'undo' | 'redo'; affectedPaths: string[] }
  | { kind: 'error'; direction: 'undo' | 'redo'; message: string };

export type TurnChangeBarProps = {
  summary: TurnChangeSummary;
  api: TurnChangesApi;
  projectPath?: string | null | undefined;
  locale?: 'zh-CN' | 'en';
};

export function TurnChangeBar(props: TurnChangeBarProps): ReactElement | null {
  const { summary, api } = props;
  const t: Copy = (zh, en) => (props.locale === 'en' ? en : zh);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<TurnChangeFileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);

  const fileCount = summary.fileCount ?? 0;
  const excluded = summary.excludedPaths ?? [];
  const recording = summary.captureState === 'collecting' || summary.captureState === 'settling';
  const undone = summary.disposition === 'undone';

  const toggleFiles = useCallback(() => {
    setExpanded((open) => !open);
    if (files === null) {
      void api
        .files(summary)
        .then(setFiles)
        .catch((error: unknown) => setFilesError(error instanceof Error ? error.message : String(error)));
    }
  }, [api, files, summary]);

  const act = useCallback(
    (direction: 'undo' | 'redo') => {
      setPhase({ kind: 'running', direction });
      void api.run(summary, direction).then((result: TurnChangeActionResult) => {
        if (result.kind === 'done') setPhase({ kind: 'idle' });
        else if (result.kind === 'conflict')
          setPhase({ kind: 'conflict', direction, affectedPaths: result.affectedPaths });
        else setPhase({ kind: 'error', direction, message: result.message });
      });
    },
    [api, summary],
  );

  const recheck = useCallback(() => {
    if (phase.kind !== 'conflict') return;
    const direction = phase.direction;
    void api.check(summary, direction).then((check) => {
      if (!check) return;
      if (check.availability.allowed) setPhase({ kind: 'idle' });
      else setPhase({ kind: 'conflict', direction, affectedPaths: check.availability.affectedPaths ?? [] });
    });
  }, [api, phase, summary]);

  if (!recording && fileCount === 0 && excluded.length === 0) {
    return null;
  }

  const stat =
    summary.additions !== null && summary.deletions !== null ? (
      <LineStat
        className="files-changed-bar-stat"
        additions={summary.additions}
        deletions={summary.deletions}
        testId="turn-change-bar-stat"
      />
    ) : null;

  let title: string;
  if (recording) title = t('正在记录本轮改动…', "Recording this turn's changes…");
  else if (fileCount === 0) title = t(`命令修改了 ${excluded.length} 个文件`, `Commands changed ${excluded.length} files`);
  else if (undone) title = t(`本轮已撤销 · 原修改 ${fileCount} 个文件`, `Undone · ${fileCount} files`);
  else title = t(`本轮修改 ${fileCount} 个文件`, `${fileCount} files changed this turn`);

  const running = phase.kind === 'running';
  const canUndo = !recording && summary.undo.allowed;
  const canRedo = !recording && summary.redo.allowed;

  return (
    <section
      className="fcb files-changed-bar turn-change-bar"
      data-testid="turn-change-bar"
      data-change-set-id={summary.changeSetId}
      data-state={recording ? 'recording' : undone ? 'undone' : summary.coverageComplete ? 'applied' : 'incomplete'}
    >
      <header className="files-changed-bar-head">
        <IconGit className="i files-changed-bar-glyph" />
        <span className="files-changed-bar-count" data-testid="turn-change-bar-title">{title}</span>
        {!recording && fileCount > 0 ? stat : null}
        <span className="turn-change-bar-actions">
          {!recording && fileCount > 0 ? (
            <button
              type="button"
              className="files-changed-bar-review"
              aria-expanded={expanded}
              onClick={toggleFiles}
              data-testid="turn-change-bar-view"
            >
              {t('查看变更', 'View changes')}
            </button>
          ) : null}
          {canUndo || (running && phase.direction === 'undo') ? (
            <button
              type="button"
              className="files-changed-bar-review turn-change-bar-primary"
              disabled={running}
              onClick={() => act('undo')}
              title={t('仅撤销这次执行的代码改动，聊天保留', 'Undo only this turn’s code changes; the chat stays')}
              data-testid="turn-change-bar-undo"
            >
              {running ? t('正在撤销…', 'Undoing…') : t('撤销', 'Undo')}
            </button>
          ) : null}
          {canRedo || (running && phase.direction === 'redo') ? (
            <button
              type="button"
              className="files-changed-bar-review turn-change-bar-primary"
              disabled={running}
              onClick={() => act('redo')}
              data-testid="turn-change-bar-redo"
            >
              {running ? t('正在恢复…', 'Restoring…') : t('恢复改动', 'Restore changes')}
            </button>
          ) : null}
        </span>
      </header>

      {!recording && !summary.coverageComplete && fileCount > 0 ? (
        <p className="turn-change-bar-note" data-testid="turn-change-bar-incomplete">
          {t('本轮改动记录不完整，无法自动撤销', 'This turn’s record is incomplete; it cannot be undone automatically')}
          {summary.incompleteReason ? `：${t(...INCOMPLETE_COPY[summary.incompleteReason])}` : ''}
        </p>
      ) : null}
      {excluded.length > 0 ? (
        <p className="turn-change-bar-note" data-testid="turn-change-bar-excluded">
          {t('由命令修改、不在撤销范围：', 'Changed by commands, not undone: ')}
          {excluded.join('、')}
        </p>
      ) : null}
      {phase.kind === 'conflict' ? (
        <div className="turn-change-bar-note turn-change-bar-alert" role="alert" data-testid="turn-change-bar-conflict">
          <span>
            {phase.direction === 'undo'
              ? t(
                  `无法撤销：${phase.affectedPaths.length} 个文件在本轮结束后又被修改。为保留后续改动，本次未修改任何文件。`,
                  `Cannot undo: ${phase.affectedPaths.length} files changed after this turn. Nothing was modified.`,
                )
              : t(
                  `无法恢复：${phase.affectedPaths.length} 个文件在撤销后又被修改。本次未修改任何文件。`,
                  `Cannot restore: ${phase.affectedPaths.length} files changed after the undo. Nothing was modified.`,
                )}
            {phase.affectedPaths.length > 0 ? ` ${phase.affectedPaths.join('、')}` : ''}
          </span>
          <button type="button" className="files-changed-bar-review" onClick={recheck} data-testid="turn-change-bar-recheck">
            {t('重新检查', 'Check again')}
          </button>
        </div>
      ) : null}
      {phase.kind === 'error' ? (
        <p className="turn-change-bar-note turn-change-bar-alert" role="alert" data-testid="turn-change-bar-error">
          {phase.direction === 'undo' ? t('撤销未执行：', 'Undo not applied: ') : t('恢复未执行：', 'Restore not applied: ')}
          {phase.message}
        </p>
      ) : null}

      {expanded ? (
        <TurnChangeFileList
          summary={summary}
          api={api}
          files={files}
          error={filesError}
          projectPath={props.projectPath}
          t={t}
        />
      ) : null}
    </section>
  );
}

function TurnChangeFileList(props: {
  summary: TurnChangeSummary;
  api: TurnChangesApi;
  files: TurnChangeFileEntry[] | null;
  error: string | null;
  projectPath?: string | null | undefined;
  t: Copy;
}): ReactElement {
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, TurnChangeFileDiff | string>>({});

  const openFile = (file: TurnChangeFileEntry): void => {
    setOpenFileId((current) => (current === file.fileId ? null : file.fileId));
    if (diffs[file.fileId] === undefined) {
      void props.api
        .diff(props.summary, file.fileId)
        .then((diff) => setDiffs((current) => ({ ...current, [file.fileId]: diff })))
        .catch((error: unknown) =>
          setDiffs((current) => ({
            ...current,
            [file.fileId]: error instanceof Error ? error.message : String(error),
          })),
        );
    }
  };

  if (props.error) {
    return <p className="turn-change-bar-note turn-change-bar-alert">{props.error}</p>;
  }
  if (props.files === null) {
    return <p className="turn-change-bar-note">{props.t('加载中…', 'Loading…')}</p>;
  }
  return (
    <ul className="files-changed-bar-list" data-testid="turn-change-bar-files">
      {props.files.map((file) => {
        const parts = formatDisplayPathParts(file.relativePath, props.projectPath);
        const tag = changeStatusTag(file.kind);
        const diff = diffs[file.fileId];
        return (
          <li key={file.fileId} className="files-changed-bar-item" title={file.relativePath}>
            <button
              type="button"
              className="files-changed-bar-row"
              aria-expanded={openFileId === file.fileId}
              onClick={() => openFile(file)}
              data-testid="turn-change-bar-file"
            >
              <span className={`files-changed-bar-row-tag ${tag.tone}`}>{tag.letter}</span>
              <span className="files-changed-bar-row-path">
                <span className="files-changed-bar-row-name">{parts.fileName}</span>
                {parts.dirPath ? <span className="files-changed-bar-row-dir">{parts.dirPath}</span> : null}
              </span>
              {file.additions !== null && file.deletions !== null ? (
                <LineStat
                  className="files-changed-bar-row-stat"
                  additions={file.additions}
                  deletions={file.deletions}
                />
              ) : null}
            </button>
            {openFileId === file.fileId ? (
              typeof diff === 'string' ? (
                <p className="turn-change-bar-note turn-change-bar-alert">{diff}</p>
              ) : diff ? (
                <DiffCard
                  projectPath={props.projectPath ?? ''}
                  path={file.relativePath}
                  request={unusedDiffRequest}
                  change={{
                    path: file.relativePath,
                    status: file.kind,
                    additions: file.additions,
                    deletions: file.deletions,
                    binary: file.binary,
                    ...(diff.patch !== undefined ? { patch: diff.patch } : {}),
                  }}
                />
              ) : (
                <p className="turn-change-bar-note">{props.t('加载中…', 'Loading…')}</p>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
