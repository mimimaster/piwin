/**
 * The turn's change summary with one-click undo / redo, from the Host's
 * sealed record (not the Git working tree). Replaces the per-call summary
 * bar whenever the turn has a record.
 *
 * A card under the turn, shown only once the record is sealed: header
 * (glyph · 本轮改动 · N 个文件 · +a −d · the one action), the files listed
 * directly, then at most one status footer — incomplete, command-changed
 * paths, conflict, or error. While the turn still records nothing renders:
 * most turns only read, and a card that appears and vanishes is noise.
 * Incomplete records and conflicts say why and never offer a forced overwrite.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  TurnChangeFileEntry,
  TurnChangeIncompleteReason,
  TurnChangePathConflict,
  TurnChangeSummary,
} from '@piwin/contracts';
import { LineStat } from '../files-changed-bar';
import { IconGit, IconRevert, IconTerminal, IconWarn } from '../shell-icons.js';
import { TurnChangeFileList } from './turn-change-file-list.js';
import { TurnChangeConflictList } from './turn-change-conflict-view.js';
import {
  AvailabilityFoot,
  COLLAPSED_COMMAND_PATHS,
  CollapsiblePathChips,
  describeRefusal,
  ExcludedPaths,
  isRefusal,
  OverlappingPaths,
  PathChips,
  StatusFoot,
  type Copy,
} from './turn-change-foot.js';
import { TurnChangeRunningFoot, type RunningNote } from './turn-change-running-foot.js';
import type { TurnChangeGestureEvent, TurnChangeRefusal } from './turn-change-gesture.js';
import type { TurnChangeActionResult, TurnChangesApi } from './turn-changes-context.js';

const INCOMPLETE_COPY: Record<TurnChangeIncompleteReason, [string, string]> = {
  'command-overlap': ['有命令也修改了本轮改过的文件', 'a command also changed a file this turn edited'],
  'command-unaudited': ['有命令的改动无法核实', "a command's changes could not be verified"],
  'chain-broken': ['文件在本轮中途被其他来源修改', 'a file was changed by something else mid-turn'],
  'capture-failed': ['有写入未能记录', 'a write could not be recorded'],
  'capture-timeout': ['记录结束时仍有工具未完成', 'a tool was still running when recording ended'],
  'storage-full': ['撤销数据已达存储上限，本轮未保存', 'undo storage is full; this turn was not kept'],
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; direction: 'undo' | 'redo'; note: RunningNote }
  | {
      kind: 'conflict';
      direction: 'undo' | 'redo';
      reason: TurnChangeRefusal;
      affectedPaths: string[];
      conflicts: TurnChangePathConflict[];
    }
  | { kind: 'error'; direction: 'undo' | 'redo'; message: string };

export type TurnChangeBarProps = {
  summary: TurnChangeSummary;
  api: TurnChangesApi;
  projectPath?: string | null | undefined;
  locale?: 'zh-CN' | 'en';
  /** `panel`: shown in the right panel's 本轮变更, so no 查看变更 link. */
  placement?: 'transcript' | 'panel';
};

export function TurnChangeBar(props: TurnChangeBarProps): ReactElement | null {
  const { summary, api } = props;
  const t: Copy = (zh, en) => (props.locale === 'en' ? en : zh);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [files, setFiles] = useState<TurnChangeFileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);

  const fileCount = summary.fileCount ?? 0;
  const excluded = summary.excludedPaths ?? [];
  const overlapping = summary.overlappingPaths ?? [];
  // Files only commands created that changed after the turn: the undo kept them.
  const leftInPlace = summary.leftInPlacePaths ?? [];
  // The side panel is where the full lists live; the transcript card stays short.
  const inPanel = props.placement === 'panel';
  const recording = summary.captureState === 'collecting' || summary.captureState === 'settling';
  // 查看冲突 put this turn's blocked paths in the panel.
  const conflictView = api.conflicts.get(summary.changeSetId);
  const undone = summary.disposition === 'undone';
  const loadFiles = !recording && fileCount > 0;

  // A sealed revision's file set is immutable: fetch once per revision.
  useEffect(() => {
    if (!loadFiles) return;
    let cancelled = false;
    setFiles(null);
    setFilesError(null);
    void api
      .files(summary)
      .then((entries) => {
        if (!cancelled) setFiles(entries);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFilesError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
    // The file set only changes with the sealed revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.files, loadFiles, summary.changeSetId, summary.revision]);

  const act = useCallback(
    (direction: 'undo' | 'redo') => {
      setPhase({ kind: 'running', direction, note: 'none' });
      const onEvent = (event: TurnChangeGestureEvent): void => {
        if (event.kind === 'reconnecting' || event.kind === 'resumed') {
          setPhase((current) =>
            current.kind === 'running'
              ? { ...current, note: event.kind === 'reconnecting' ? 'reconnecting' : 'none' }
              : current,
          );
        }
      };
      void api.run(summary, direction, onEvent).then((result: TurnChangeActionResult) => {
        if (result.kind === 'done') setPhase({ kind: 'idle' });
        else if (result.kind === 'conflict')
          setPhase({
            kind: 'conflict',
            direction,
            reason: result.reason,
            affectedPaths: result.affectedPaths,
            conflicts: result.conflicts,
          });
        else if (result.kind === 'not-applied')
          setPhase({
            kind: 'error',
            direction,
            message:
              result.reason === 'cancelled'
                ? t('已取消，文件未改变。', 'Cancelled; no file was changed.')
                : t('写入失败，已回退，文件未改变。', 'A write failed and was rolled back; no file changed.'),
          });
        else if (result.kind === 'needs-repair')
          setPhase({
            kind: 'error',
            direction,
            message: t(
              '写入中途失败且未能自动回退，请在「更改 → 更多 → 代码撤销记录」中修复。',
              'A write failed and could not be rolled back. Repair it from Changes → More → Undo history.',
            ),
          });
        else setPhase({ kind: 'error', direction, message: result.message });
      });
    },
    // `t` only reads the locale prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, summary, props.locale],
  );

  const recheck = useCallback(() => {
    if (phase.kind !== 'conflict') return;
    const direction = phase.direction;
    void api.check(summary, direction).then((check) => {
      if (!check) return;
      const availability = check.availability;
      if (availability.allowed) {
        setPhase({ kind: 'idle' });
      } else if (isRefusal(availability.reason)) {
        setPhase({
          kind: 'conflict',
          direction,
          reason: availability.reason,
          affectedPaths: availability.affectedPaths ?? [],
          conflicts: availability.conflicts ?? [],
        });
      } else {
        setPhase({ kind: 'error', direction, message: availability.reason });
      }
    });
  }, [api, phase, summary]);

  if (recording || (fileCount === 0 && excluded.length === 0)) {
    return null;
  }

  const commandsOnly = fileCount === 0;
  const incomplete = !commandsOnly && !summary.coverageComplete;
  const running = phase.kind === 'running';
  // A blocked direction stays hidden until 重新检查 clears it; retrying the
  // same click would only fail the same way.
  const blocked = phase.kind === 'conflict' ? phase.direction : null;
  const showUndo = (summary.undo.allowed && blocked !== 'undo') || (running && phase.direction === 'undo');
  const showRedo = (summary.redo.allowed && blocked !== 'redo') || (running && phase.direction === 'redo');

  let title: string;
  let meta: string;
  if (commandsOnly) {
    title = t('命令改动', 'Command changes');
    meta = t(`${excluded.length} 个文件`, `${excluded.length} files`);
  } else if (undone) {
    title = t('本轮已撤销', 'Undone');
    meta = t(`原修改 ${fileCount} 个文件`, `${fileCount} files were changed`);
  } else {
    title = t('本轮改动', 'This turn');
    meta = t(`${fileCount} 个文件`, `${fileCount} files`);
  }

  const state = phase.kind === 'conflict' ? 'conflict' : undone ? 'undone' : incomplete ? 'incomplete' : 'applied';

  return (
    <section
      className="fcb files-changed-bar turn-change-bar"
      data-testid="turn-change-bar"
      data-change-set-id={summary.changeSetId}
      data-state={state}
    >
      <header className="files-changed-bar-head">
        {undone ? (
          <IconRevert className="i files-changed-bar-glyph" />
        ) : commandsOnly ? (
          <IconTerminal className="i files-changed-bar-glyph" />
        ) : (
          <IconGit className="i files-changed-bar-glyph" />
        )}
        <span className="turn-change-bar-summary">
          <span className="files-changed-bar-count" data-testid="turn-change-bar-title">{title}</span>
          <span className="turn-change-bar-meta" data-testid="turn-change-bar-meta">{meta}</span>
          {!commandsOnly && summary.additions !== null && summary.deletions !== null ? (
            <LineStat
              className="files-changed-bar-stat"
              additions={summary.additions}
              deletions={summary.deletions}
              testId="turn-change-bar-stat"
            />
          ) : null}
        </span>
        <span className="turn-change-bar-actions">
          {showUndo ? (
            <button
              type="button"
              className="turn-change-bar-action"
              disabled={running}
              onClick={() => act('undo')}
              title={t('仅撤销这次执行的代码改动，聊天保留', 'Undo only this turn’s code changes; the chat stays')}
              data-testid="turn-change-bar-undo"
              aria-label={t('撤销本轮改动', 'Undo this turn')}
            >
              <IconRevert className="i" />
              <span className="turn-change-bar-action-label">{running ? t('正在撤销…', 'Undoing…') : t('撤销', 'Undo')}</span>
            </button>
          ) : null}
          {showRedo ? (
            <button
              type="button"
              className="turn-change-bar-action"
              disabled={running}
              onClick={() => act('redo')}
              title={t('重新应用本轮撤掉的改动', 'Re-apply the changes this undo removed')}
              data-testid="turn-change-bar-redo"
              aria-label={t('恢复本轮改动', 'Restore this turn')}
            >
              <IconRevert className="i turn-change-bar-redo-glyph" />
              <span className="turn-change-bar-action-label">{running ? t('正在恢复…', 'Restoring…') : t('恢复改动', 'Restore changes')}</span>
            </button>
          ) : null}
          {incomplete ? (
            <span className="turn-change-bar-pill" data-testid="turn-change-bar-locked">
              <IconWarn className="i" />
              {t('不可撤销', 'Cannot undo')}
            </span>
          ) : null}
          {props.placement !== 'panel' && !commandsOnly ? (
            <button
              type="button"
              className="turn-change-bar-action quiet"
              onClick={() => api.focusChangeSet(summary.changeSetId)}
              title={t('在右侧「本轮变更」中查看', 'Open in the side panel')}
              data-testid="turn-change-bar-open"
            >
              <span className="turn-change-bar-action-label">{t('查看变更', 'View changes')}</span>
            </button>
          ) : null}
        </span>
      </header>

      {loadFiles && props.placement === 'panel' && conflictView ? (
        <TurnChangeConflictList
          summary={summary}
          api={api}
          view={conflictView}
          files={files}
          projectPath={props.projectPath}
          t={t}
        />
      ) : loadFiles ? (
        files ? (
          <TurnChangeFileList summary={summary} api={api} files={files} projectPath={props.projectPath} t={t} />
        ) : (
          <p className="turn-change-bar-inline-note turn-change-bar-files-pending">
            {filesError ?? t('加载中…', 'Loading…')}
          </p>
        )
      ) : null}

      {!incomplete && undone && leftInPlace.length > 0 ? (
        <StatusFoot tone="info" testId="turn-change-bar-left-in-place">
          {t(
            `有 ${leftInPlace.length} 个命令新建的文件在这一轮之后又被改动，撤销没有动它们`,
            `${leftInPlace.length} files created by commands changed afterwards; undo left them in place`,
          )}
          <CollapsiblePathChips
            paths={leftInPlace}
            visible={COLLAPSED_COMMAND_PATHS}
            defaultOpen={inPanel}
            moreLabel={(hidden) => t(`另有 ${hidden} 个`, `${hidden} more`)}
            lessLabel={t('收起', 'Show less')}
            testId="turn-change-bar-left-in-place-paths"
          />
          {excluded.length > 0 ? <ExcludedPaths paths={excluded} full={inPanel} t={t} /> : null}
        </StatusFoot>
      ) : incomplete ? (
        <StatusFoot tone="warn" testId="turn-change-bar-incomplete">
          {t('记录不完整，无法自动撤销', 'This turn’s record is incomplete; it cannot be undone automatically')}
          {summary.incompleteReason ? `：${t(...INCOMPLETE_COPY[summary.incompleteReason])}` : ''}
          {overlapping.length > 0 ? <OverlappingPaths paths={overlapping} full={inPanel} t={t} /> : null}
          {excluded.length > 0 ? <ExcludedPaths paths={excluded} full={inPanel} t={t} /> : null}
        </StatusFoot>
      ) : excluded.length > 0 ? (
        <StatusFoot tone="info" testId="turn-change-bar-excluded">
          {commandsOnly
            ? t('这些文件由命令修改，不在撤销范围', 'Changed by commands; undo leaves them alone')
            : t('以下文件由命令修改，撤销不会动它们', 'Changed by commands; undo leaves them alone')}
          <CollapsiblePathChips
            paths={excluded}
            visible={COLLAPSED_COMMAND_PATHS}
            defaultOpen={inPanel}
            moreLabel={(hidden) => t(`另有 ${hidden} 个由命令修改`, `${hidden} more changed by commands`)}
            lessLabel={t('收起', 'Show less')}
            testId="turn-change-bar-excluded-paths"
          />
        </StatusFoot>
      ) : null}

      {phase.kind === 'running' ? (
        <TurnChangeRunningFoot
          api={api}
          changeSetId={summary.changeSetId}
          direction={phase.direction}
          note={phase.note}
          onNote={(note) => setPhase((current) => (current.kind === 'running' ? { ...current, note } : current))}
          t={t}
        />
      ) : null}
      {phase.kind === 'idle' ? <AvailabilityFoot summary={summary} t={t} /> : null}

      {phase.kind === 'conflict' ? (
        <StatusFoot
          tone="error"
          testId="turn-change-bar-conflict"
          action={
            <span className="turn-change-bar-foot-actions">
              {phase.affectedPaths.length > 0 ? (
                <button
                  type="button"
                  className="turn-change-bar-action quiet"
                  onClick={() =>
                    api.showConflict(summary.changeSetId, {
                      direction: phase.direction,
                      reason: phase.reason,
                      conflicts:
                        phase.conflicts.length > 0
                          ? phase.conflicts
                          : phase.affectedPaths.map((relativePath) => ({ relativePath, laterTurns: [] })),
                    })
                  }
                  data-testid="turn-change-bar-view-conflict"
                >
                  {t('查看冲突', 'View conflict')}
                </button>
              ) : null}
              <button type="button" className="turn-change-bar-action quiet" onClick={recheck} data-testid="turn-change-bar-recheck">
                {t('重新检查', 'Check again')}
              </button>
            </span>
          }
        >
          {describeRefusal(phase.direction, phase.reason, phase.affectedPaths.length, t)}
          {phase.affectedPaths.length > 0 ? <PathChips paths={phase.affectedPaths} /> : null}
        </StatusFoot>
      ) : null}
      {phase.kind === 'error' ? (
        <StatusFoot tone="error" testId="turn-change-bar-error">
          {phase.direction === 'undo' ? t('撤销未执行：', 'Undo not applied: ') : t('恢复未执行：', 'Restore not applied: ')}
          {phase.message}
        </StatusFoot>
      ) : null}
    </section>
  );
}
