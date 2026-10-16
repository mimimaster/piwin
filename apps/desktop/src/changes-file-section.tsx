/**
 * One file in the Changes stack: a sticky header (status, path, stats, copy,
 * stage checkbox) over its unified diff. The patch loads the first time the
 * section opens and refetches when the working tree reloads (`revision`),
 * keeping the previous patch on screen meanwhile so open diffs never flash.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { GitFileDiff } from '@piwin/contracts';
import { IconButton, Notice } from '@piwin/ui-kit';
import { DiffView } from './diff-view';
import { IconChevronRight, IconCopy } from './shell-icons';
import { formatDisplayPathParts, resolveChangeStatusInfo } from './truncate-relative-path';
import { diffScopeFor, stageStateOf, type ChangeRow, type WorktreeScope } from './changes-scope';
import type { GitChangesRequest } from './use-git-changes';

export type ChangesFileSectionProps = {
  row: ChangeRow;
  scope: WorktreeScope;
  projectPath: string;
  request: GitChangesRequest;
  revision: number;
  expanded: boolean;
  busy: boolean;
  locale: 'zh-CN' | 'en';
  onToggleExpanded: (path: string) => void;
  onToggleStaged: (row: ChangeRow) => void;
};

type PatchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; diff: GitFileDiff };

export function ChangesFileSection(props: ChangesFileSectionProps): ReactElement {
  const { row, scope, projectPath, request, revision, expanded } = props;
  const isZh = props.locale === 'zh-CN';
  const [patch, setPatch] = useState<PatchState>({ kind: 'idle' });

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setPatch((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    request({ type: 'git/diff-file', projectPath, path: row.path, scope: diffScopeFor(scope) })
      .then((response) => {
        if (cancelled) return;
        setPatch(
          response.success
            ? { kind: 'ready', diff: (response.data as { diff: GitFileDiff }).diff }
            : { kind: 'error', message: response.error },
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setPatch({ kind: 'error', message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, request, projectPath, row.path, scope, revision]);

  const parts = formatDisplayPathParts(row.path, projectPath);
  const status = resolveChangeStatusInfo(row.status, props.locale);
  // The summary is worktree-vs-HEAD; a staged/unstaged slice shows its own patch's stats.
  const loaded = patch.kind === 'ready' ? patch.diff : null;
  const additions = scope === 'uncommitted' ? row.additions : (loaded?.additions ?? null);
  const deletions = scope === 'uncommitted' ? row.deletions : (loaded?.deletions ?? null);
  const stageState = stageStateOf(row);

  return (
    <section
      className={expanded ? 'changes-file expanded' : 'changes-file'}
      data-testid="changes-file"
      data-path={row.path}
    >
      <header className="changes-file-head">
        <button
          type="button"
          className="changes-file-toggle"
          aria-expanded={expanded}
          data-testid="changes-file-toggle"
          onClick={() => props.onToggleExpanded(row.path)}
        >
          <IconChevronRight className="changes-file-chevron" width={12} height={12} />
          <span className={`changes-code status-${row.status}`} title={status.label}>
            {status.shortCode}
          </span>
          <span className="changes-path" title={row.path}>
            {parts.dirPath ? <span className="changes-path-dir">{parts.dirPath}</span> : null}
            <span className="changes-path-file">{parts.fileName}</span>
          </span>
          <span className="changes-stats">
            {additions ? <span className="add">+{additions}</span> : null}
            {deletions ? <span className="del">−{deletions}</span> : null}
          </span>
        </button>
        <IconButton
          className="changes-file-copy"
          label={isZh ? '复制路径' : 'Copy path'}
          size={22}
          onClick={() => void navigator.clipboard?.writeText(row.path)}
        >
          <IconCopy width={13} height={13} />
        </IconButton>
        <StageCheckbox
          state={stageState}
          disabled={props.busy}
          label={
            stageState === 'staged'
              ? `${isZh ? '取消暂存' : 'Unstage'} ${row.path}`
              : `${isZh ? '暂存' : 'Stage'} ${row.path}`
          }
          onToggle={() => props.onToggleStaged(row)}
        />
      </header>
      {expanded ? (
        <div className="changes-file-body">
          {patch.kind === 'ready' ? (
            <DiffView
              patch={patch.diff.patch}
              mode="unified"
              path={row.path}
              isBinary={patch.diff.isBinary}
              truncated={patch.diff.truncated}
              hideHeader={true}
              hideMetadata={true}
              locale={props.locale}
              emptyMessage={isZh ? '无文本变更' : 'No textual changes'}
            />
          ) : patch.kind === 'error' ? (
            <Notice tone="error">{patch.message}</Notice>
          ) : (
            <div className="changes-file-loading muted" data-testid="changes-file-loading">
              {isZh ? '正在加载变更…' : 'Loading diff…'}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function StageCheckbox(props: {
  state: 'staged' | 'partial' | 'unstaged';
  disabled: boolean;
  label: string;
  onToggle: () => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  // `indeterminate` exists only as a DOM property, never as an attribute.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.state === 'partial';
  }, [props.state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="changes-stage-check"
      data-testid="changes-stage-check"
      data-stage-state={props.state}
      checked={props.state === 'staged'}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      onChange={props.onToggle}
    />
  );
}
