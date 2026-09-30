/**
 * \u67e5\u770b\u51b2\u7a81: why an undo/redo was refused, path by path.
 *
 * For each blocked path: who changed it after this turn (a later turn, or
 * \u6765\u6e90\u672a\u77e5 \u2014 never a guess), this turn's own diff, and the turn's result
 * \u2192 the file now. A later turn in this conversation offers \u5b9a\u4f4d\u5230\u540e\u7eed\u8f6e\u6b21;
 * whether to undo that one first is the user's call. Nothing here writes.
 */
import { useState, type ReactElement } from 'react';
import type { TurnChangeFileDiff, TurnChangeFileEntry, TurnChangeSummary } from '@piwin/contracts';

import { DiffCard, type DiffCardRequest } from '../diff-card';
import type { Copy } from './turn-change-foot.js';
import type { TurnChangeConflictView, TurnChangesApi } from './turn-changes-context.js';

const unusedDiffRequest: DiffCardRequest = () =>
  Promise.resolve({ type: 'response', command: 'git/diff-file', success: false, error: 'not used' });

const REASON_COPY: Record<TurnChangeConflictView['reason'], [string, string]> = {
  'files-changed': ['\u8fd9\u4e9b\u6587\u4ef6\u5728\u672c\u8f6e\u7ed3\u675f\u540e\u53c8\u88ab\u4fee\u6539', 'These files changed after this turn'],
  'staged-paths': [
    '\u8fd9\u4e9b\u6587\u4ef6\u6709\u5df2\u6682\u5b58\u6216\u672a\u89e3\u51b3\u7684\u51b2\u7a81\u3002\u64a4\u9500\u4e0d\u52a8 Git \u6682\u5b58\u533a\uff0c\u8bf7\u5148\u53d6\u6d88\u6682\u5b58\u6216\u89e3\u51b3\u51b2\u7a81\u3002',
    'These files have staged or unmerged changes. Undo never touches the Git index; unstage or resolve first.',
  ],
  'backup-failed': [
    '\u64a4\u9500\u6240\u9700\u7684\u5907\u4efd\u4e0d\u53ef\u7528\uff0c\u672c\u6b21\u672a\u4fee\u6539\u4efb\u4f55\u6587\u4ef6\u3002',
    'The backup undo needs is not available; nothing was changed.',
  ],
  'permission-denied': [
    'Host \u6ca1\u6709\u6743\u9650\u8bfb\u5199\u8fd9\u4e9b\u6587\u4ef6\uff0c\u672c\u6b21\u672a\u4fee\u6539\u4efb\u4f55\u6587\u4ef6\u3002',
    'The Host cannot read or write these files; nothing was changed.',
  ],
};

export function TurnChangeConflictList(props: {
  summary: TurnChangeSummary;
  api: TurnChangesApi;
  view: TurnChangeConflictView;
  files: TurnChangeFileEntry[] | null;
  projectPath?: string | null | undefined;
  t: Copy;
}): ReactElement {
  const { summary, api, view, t } = props;
  return (
    <section className="turn-change-conflicts" data-testid="turn-change-conflicts" aria-label={t('\u51b2\u7a81', 'Conflicts')}>
      <p className="turn-change-conflicts-lead">{t(...REASON_COPY[view.reason])}</p>
      <ul className="turn-change-conflicts-list">
        {view.conflicts.map((conflict) => (
          <ConflictRow
            key={conflict.relativePath}
            summary={summary}
            api={api}
            relativePath={conflict.relativePath}
            laterTurns={conflict.laterTurns}
            file={props.files?.find((file) => file.relativePath === conflict.relativePath)}
            showSource={view.reason === 'files-changed'}
            projectPath={props.projectPath}
            t={t}
          />
        ))}
      </ul>
      <button
        type="button"
        className="turn-change-bar-action quiet"
        onClick={() => api.showConflict(summary.changeSetId, null)}
        data-testid="turn-change-conflicts-close"
      >
        {t('\u8fd4\u56de\u6587\u4ef6\u5217\u8868', 'Back to the file list')}
      </button>
    </section>
  );
}

function ConflictRow(props: {
  summary: TurnChangeSummary;
  api: TurnChangesApi;
  relativePath: string;
  laterTurns: TurnChangeConflictView['conflicts'][number]['laterTurns'];
  file: TurnChangeFileEntry | undefined;
  showSource: boolean;
  projectPath?: string | null | undefined;
  t: Copy;
}): ReactElement {
  const { api, summary, t } = props;
  const [open, setOpen] = useState<'sealed' | 'current' | null>(null);
  const [diffs, setDiffs] = useState<Partial<Record<'sealed' | 'current', TurnChangeFileDiff | string>>>({});
  const [revealMiss, setRevealMiss] = useState(false);

  const show = (against: 'sealed' | 'current'): void => {
    setOpen((current) => (current === against ? null : against));
    const file = props.file;
    if (!file || diffs[against] !== undefined) return;
    void api
      .diff(summary, file.fileId, against)
      .then((diff) => setDiffs((current) => ({ ...current, [against]: diff })))
      .catch((error: unknown) =>
        setDiffs((current) => ({ ...current, [against]: error instanceof Error ? error.message : String(error) })),
      );
  };
  const diff = open ? diffs[open] : undefined;

  return (
    <li className="turn-change-conflict" data-testid="turn-change-conflict">
      <code className="turn-change-bar-chip" title={props.relativePath}>
        {props.relativePath}
      </code>
      {props.showSource ? (
        props.laterTurns.length === 0 ? (
          <span className="turn-change-conflict-source" data-testid="turn-change-conflict-source">
            {t('\u6765\u6e90\u672a\u77e5\uff08\u7f16\u8f91\u5668\u3001\u547d\u4ee4\u6216\u5176\u4ed6\u5de5\u5177\uff09', 'Source unknown (an editor, a command, or another tool)')}
          </span>
        ) : (
          props.laterTurns.map((later) => {
            const sameSession = later.sessionId === summary.sessionId;
            return (
              <span key={later.changeSetId} className="turn-change-conflict-source" data-testid="turn-change-conflict-source">
                {sameSession
                  ? t('\u672c\u5bf9\u8bdd\u540e\u7eed\u4e00\u8f6e\u4fee\u6539\u4e86\u5b83', 'A later turn of this chat changed it')
                  : t('\u53e6\u4e00\u4e2a\u4f1a\u8bdd\u7684\u4e00\u8f6e\u4fee\u6539\u4e86\u5b83', 'A turn in another session changed it')}
                {sameSession ? (
                  <button
                    type="button"
                    className="turn-change-bar-action quiet"
                    onClick={() => setRevealMiss(!api.revealChangeSet(later.changeSetId))}
                    data-testid="turn-change-conflict-reveal"
                  >
                    {t('\u5b9a\u4f4d\u5230\u540e\u7eed\u8f6e\u6b21', 'Go to that turn')}
                  </button>
                ) : null}
              </span>
            );
          })
        )
      ) : null}
      {revealMiss ? (
        <span className="turn-change-conflict-source muted">
          {t('\u90a3\u4e00\u8f6e\u4e0d\u5728\u5f53\u524d\u663e\u793a\u7684\u5bf9\u8bdd\u91cc\uff0c\u5411\u4e0a\u6eda\u52a8\u52a0\u8f7d\u540e\u518d\u8bd5\u3002', 'That turn is not loaded; scroll up and try again.')}
        </span>
      ) : null}
      {props.file ? (
        <span className="turn-change-conflict-actions">
          <button
            type="button"
            className="turn-change-bar-action quiet"
            aria-pressed={open === 'sealed'}
            onClick={() => show('sealed')}
            data-testid="turn-change-conflict-sealed"
          >
            {t('\u672c\u8f6e\u6539\u52a8', 'This turn’s change')}
          </button>
          <button
            type="button"
            className="turn-change-bar-action quiet"
            aria-pressed={open === 'current'}
            onClick={() => show('current')}
            data-testid="turn-change-conflict-current"
          >
            {t('\u672c\u8f6e\u7ed3\u679c \u2192 \u5f53\u524d\u6587\u4ef6', 'Turn result → file now')}
          </button>
        </span>
      ) : null}
      {open && props.file ? (
        typeof diff === 'string' ? (
          <p className="turn-change-bar-inline-note">{diff}</p>
        ) : diff ? (
          diff.currentMissing ? (
            <p className="turn-change-bar-inline-note">{t('\u6587\u4ef6\u5df2\u88ab\u5220\u9664\u3002', 'The file has been deleted.')}</p>
          ) : (
            <DiffCard
              projectPath={props.projectPath ?? ''}
              path={props.relativePath}
              request={unusedDiffRequest}
              chrome="body"
              change={{
                path: props.relativePath,
                status: 'modified',
                additions: diff.additions,
                deletions: diff.deletions,
                binary: diff.binary,
                ...(diff.patch !== undefined ? { patch: diff.patch } : {}),
              }}
            />
          )
        ) : (
          <p className="turn-change-bar-inline-note">{t('\u52a0\u8f7d\u4e2d\u2026', 'Loading…')}</p>
        )
      ) : null}
    </li>
  );
}
