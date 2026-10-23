/**
 * Right-panel Changes: one toolbar (scope picker · ⋯ · 提交) over the body of
 * the chosen scope. Working-tree scopes stack every file's diff in one scroll
 * (Cursor / Codex review style); the turn record, commit history, and
 * subagent results are slots the composition root fills when they exist.
 * See docs/specs/changes-panel-scopes.md.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Notice,
} from '@piwin/ui-kit';
import { IconMore } from '../tool-cards/shell-icons';
import {
  isSectionExpanded,
  isWorktreeScope,
  nextStageAction,
  rowsInScope,
  tallyScope,
  WORKTREE_SCOPES,
  type ChangeRow,
  type ChangesScope,
  type ScopeTally,
  type WorktreeScope,
} from './changes-scope';
import { ChangesScopeEmpty, ChangesScopeMenu, type ScopeOption } from './changes-scope-menu';
import { ChangesFileSection } from './changes-file-section';
import { ChangesCommitPopover } from './changes-commit-popover';
import { useGitChanges, type GitChangesRequest } from '../hooks/use-git-changes';

export type ChangesPanelProps = {
  projectPath: string | null;
  request: GitChangesRequest;
  locale?: 'zh-CN' | 'en' | undefined;
  /** 本轮变更: the sealed turn record; omitted when the Host has no turn changes. */
  turn?: { content: ReactNode; tally: ScopeTally | null } | undefined;
  /** 提交历史 body (branch actions + log). */
  history?: ReactNode;
  /** 子任务结果 body; omitted when there are none. */
  result?: ReactNode;
  /** Extra ⋯ menu entries after the panel's own. */
  moreMenuItems?: ReactNode;
  /** Ask for a scope; re-applied whenever `scopeRequest` changes, even to the same value. */
  scope?: ChangesScope | undefined;
  scopeRequest?: number | undefined;
  resultId?: string | undefined;
  changeSetId?: string | undefined;
};

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const isZh = locale === 'zh-CN';
  const git = useGitChanges(props.projectPath, props.request);
  const [requestedScope, setRequestedScope] = useState<ChangesScope>(props.scope ?? 'uncommitted');
  const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

  useEffect(() => {
    if (props.scope !== undefined) setRequestedScope(props.scope);
  }, [props.scope, props.scopeRequest]);

  const options = useMemo<ScopeOption[]>(() => {
    const list: ScopeOption[] = [];
    if (props.turn) list.push({ scope: 'turn', tally: props.turn.tally });
    for (const scope of WORKTREE_SCOPES) list.push({ scope, tally: tallyScope(git.rows, scope) });
    if (props.history != null) list.push({ scope: 'history', tally: null });
    if (props.result != null) list.push({ scope: 'result', tally: null });
    return list;
  }, [props.turn, props.history, props.result, git.rows]);

  // A requested slot that disappeared (results resolved, no turn Host) falls back to the tree.
  const scope: ChangesScope = options.some((option) => option.scope === requestedScope)
    ? requestedScope
    : 'uncommitted';
  const scopedRows = isWorktreeScope(scope) ? rowsInScope(git.rows, scope) : [];
  const stagedCount = git.rows.filter((row) => row.staged).length;
  const isRepository = git.snapshot?.repository.isRepository ?? false;

  const toggleExpanded = useCallback((path: string) => {
    setExpandedOverrides((current) => {
      const index = scopedRows.findIndex((row) => row.path === path);
      const next = new Map(current);
      next.set(path, !isSectionExpanded(path, index, current));
      return next;
    });
  }, [scopedRows]);

  function setAllExpanded(expanded: boolean): void {
    setExpandedOverrides(new Map(scopedRows.map((row) => [row.path, expanded])));
  }

  const toggleStaged = useCallback(
    (row: ChangeRow) => void git.setStaged(nextStageAction(row), [row.path]),
    [git.setStaged],
  );

  if (!props.projectPath) {
    return (
      <div className="changes-panel" data-testid="changes-panel">
        <div className="right-panel-empty muted">
          {isZh ? '打开项目查看文件变更' : 'Open a project to see file changes.'}
        </div>
      </div>
    );
  }

  const allExpanded =
    scopedRows.length > 0 &&
    scopedRows.every((row, index) => isSectionExpanded(row.path, index, expandedOverrides));

  return (
    <div
      className="changes-panel"
      data-testid="changes-panel"
      data-changes-scope={scope}
      {...(props.resultId !== undefined ? { 'data-result-id': props.resultId } : {})}
      {...(props.changeSetId !== undefined ? { 'data-change-set-id': props.changeSetId } : {})}
    >
      <div className="changes-toolbar" data-testid="changes-toolbar">
        <ChangesScopeMenu scope={scope} options={options} locale={locale} onSelect={setRequestedScope} />
        <span className="changes-toolbar-spacer" />
        <DropdownMenu
          align="end"
          label={isZh ? '更多' : 'More'}
          testId="changes-more-menu"
          trigger={
            <IconButton label={isZh ? '更多' : 'More'} size={26} data-testid="changes-more">
              <IconMore width={15} height={15} />
            </IconButton>
          }
        >
          <DropdownMenuItem
            testId="changes-refresh"
            disabled={git.loading}
            onSelect={() => void git.reload()}
          >
            {isZh ? '刷新' : 'Refresh'}
          </DropdownMenuItem>
          {isWorktreeScope(scope) && scopedRows.length > 0 ? (
            <>
              <DropdownMenuItem testId="changes-toggle-all" onSelect={() => setAllExpanded(!allExpanded)}>
                {allExpanded ? (isZh ? '全部折叠' : 'Collapse all') : isZh ? '全部展开' : 'Expand all'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testId="changes-stage-all"
                disabled={git.busy || !git.rows.some((row) => row.unstaged)}
                onSelect={() => void git.setStaged('stage', [])}
              >
                {isZh ? '暂存全部' : 'Stage all'}
              </DropdownMenuItem>
              <DropdownMenuItem
                testId="changes-unstage-all"
                disabled={git.busy || stagedCount === 0}
                onSelect={() => void git.setStaged('unstage', [])}
              >
                {isZh ? '取消暂存全部' : 'Unstage all'}
              </DropdownMenuItem>
            </>
          ) : null}
          {props.moreMenuItems ? (
            <>
              <DropdownMenuSeparator />
              {props.moreMenuItems}
            </>
          ) : null}
        </DropdownMenu>
        {isWorktreeScope(scope) && isRepository && git.rows.length > 0 ? (
          <ChangesCommitPopover
            stagedCount={stagedCount}
            totalCount={git.rows.length}
            busy={git.busy}
            locale={locale}
            onCommit={git.commit}
          />
        ) : null}
      </div>

      {git.error ? <Notice tone="error">{git.error}</Notice> : null}

      <div className="changes-body" data-changes-scope={scope}>
        {scope === 'turn'
          ? props.turn?.content
          : scope === 'history'
            ? props.history
            : scope === 'result'
              ? props.result
              : renderWorktree(scope)}
      </div>
    </div>
  );

  function renderWorktree(worktreeScope: WorktreeScope): ReactNode {
    if (!git.snapshot) {
      return git.loading ? (
        <div className="right-panel-empty muted">{isZh ? '正在读取工作区…' : 'Reading working tree…'}</div>
      ) : null;
    }
    if (!isRepository) {
      return <div className="right-panel-empty muted">{isZh ? '非 Git 仓库' : 'Not a git repository.'}</div>;
    }
    if (scopedRows.length === 0) {
      return <ChangesScopeEmpty scope={worktreeScope} options={options} locale={locale} onSelect={setRequestedScope} />;
    }
    const projectPath = props.projectPath ?? '';
    return (
      <div className="changes-files" data-testid="changes-files" data-changes-count={scopedRows.length}>
        {scopedRows.map((row, index) => (
          <ChangesFileSection
            key={row.path}
            row={row}
            scope={worktreeScope}
            projectPath={projectPath}
            request={props.request}
            revision={git.revision}
            expanded={isSectionExpanded(row.path, index, expandedOverrides)}
            busy={git.busy}
            locale={locale}
            onToggleExpanded={toggleExpanded}
            onToggleStaged={toggleStaged}
          />
        ))}
        {git.snapshot.truncated ? (
          <p className="changes-truncated muted">
            {isZh
              ? `仅显示部分文件（共 ${git.snapshot.totalChangedFiles} 个）`
              : `Showing some of ${git.snapshot.totalChangedFiles} files`}
          </p>
        ) : null}
      </div>
    );
  }
}
