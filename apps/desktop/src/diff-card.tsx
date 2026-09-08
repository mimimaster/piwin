/**
 * Inline diff card for write/edit tool calls.
 * Lazily fetches a single-file patch via the `git/diff-file` host IPC and
 * renders it inline with Accept / Reject review actions.
 * Visual structure mirrors the prototype diff card (ui-prototype-v7.html).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { GitFileDiff, HostResponse } from '@piwin/contracts';
import { parseUnifiedDiff } from './diff-view';
import { computeDiffLineNumbers } from './diff-line-numbers';
import {
  useHighlightLines,
  languageFromPath,
  TokenSpans,
  type TokenLine,
} from './syntax-highlight';

import { CollapsibleContentBlock } from './collapsible-content-block';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';
import { resolveProjectEntryAbsolutePath } from './file-tree-path.js';
import { IconFile } from './shell-icons.js';

/**
 * Same request signature injected into ChangesPanel (changes-panel.tsx:38).
 * Narrowed to the `git/diff-file` command this card actually issues.
 */
export type DiffCardRequest = (command: {
  type: 'git/diff-file';
  projectPath: string;
  path: string;
  scope?: 'worktree' | 'staged' | 'combined';
}) => Promise<HostResponse>;

/**
 * Count added / deleted content lines in a unified diff, skipping the
 * `---` / `+++` file headers (those are metadata, not content changes).
 */
export function diffLineStats(diff: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) adds += 1;
    else if (line.startsWith('-')) dels += 1;
  }
  return { adds, dels };
}

type DiffState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; fileDiff: GitFileDiff };

export type DiffCardProps = {
  projectPath: string;
  path: string;
  request: DiffCardRequest;
  onReview?: (path: string, ok: boolean) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (absolutePath: string, relativePath?: string) => void;
};

export function DiffCard(props: DiffCardProps): ReactElement {
  const [state, setState] = useState<DiffState>({ kind: 'loading' });
  const [verdict, setVerdict] = useState<'accepted' | 'rejected' | null>(null);
  const contextMenu = useDesktopContextMenu();

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    // Same call + response unpacking pattern as changes-panel.tsx:129-149.
    void props
      .request({
        type: 'git/diff-file',
        projectPath: props.projectPath,
        path: props.path,
        scope: 'combined',
      })
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setState({ kind: 'error', message: response.error });
          return;
        }
        setState({ kind: 'ready', fileDiff: (response.data as { diff: GitFileDiff }).diff });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.path]);

  const patch = state.kind === 'ready' ? state.fileDiff.patch : '';
  const lines = useMemo(() => parseUnifiedDiff(patch), [patch]);
  const lineNumbers = useMemo(() => computeDiffLineNumbers(lines), [lines]);
  const sourceLang = useMemo(
    () => (props.path ? languageFromPath(props.path) : 'typescript'),
    [props.path],
  );
  const contentTexts = useMemo(
    () =>
      lines.map((line) =>
        line.kind === 'context' || line.kind === 'add' || line.kind === 'del' ? line.text : '',
      ),
    [lines],
  );
  const tokenMap = useHighlightLines(contentTexts, sourceLang);
  const stats = diffLineStats(patch);

  // Extract first hunk tag e.g. @@ 85,7 @@
  const firstHunkTag = useMemo(() => {
    const hunkLine = lines.find((l) => l.kind === 'hunk');
    if (!hunkLine) return null;
    const match = hunkLine.text.match(/@@\s*[-+0-9, ]+\s*@@/);
    return match ? match[0] : null;
  }, [lines]);

  const fileName = useMemo(() => {
    const segments = props.path.split('/');
    return segments[segments.length - 1] || props.path;
  }, [props.path]);

  const totalChanges = stats.adds + stats.dels;

  // CM-12: diff-row surface menu on the whole card.
  const diffTarget: ContextMenuTarget | null =
    contextMenu && patch.trim().length > 0
      ? {
          surface: 'diff-row',
          projectPath: props.projectPath,
          relativePath: props.path,
          snapshotText: patch,
          label: props.path,
        }
      : null;

  const card = (
    <div
      className={`diff-card dc${verdict === 'accepted' ? ' accepted' : ''}`}
      data-testid="diff-card"
    >
      <div className="diff-head dc-h" data-testid="diff-head">
        <span className="pc file" title={props.path}>
          <IconFile className="i s12" />
          <span>{fileName}</span>
        </span>
        <span className="pm stat num" data-testid="diff-stats">
          {stats.adds > 0 && <span className="plus add">+{stats.adds}</span>}
          {stats.adds > 0 && stats.dels > 0 && ' '}
          {stats.dels > 0 && <span className="minus del">−{stats.dels}</span>}
        </span>
        {firstHunkTag ? (
          <>
            <span className="sep">·</span>
            <span className="hunk">{firstHunkTag}</span>
          </>
        ) : null}
        <span className="acts ml">
          {props.onOpenFile ? (
            <button
              type="button"
              className="btn sm"
              data-testid="diff-open-file"
              onClick={() => props.onOpenFile?.(props.path)}
            >
              打开
            </button>
          ) : null}
          {verdict === null ? (
            <button
              type="button"
              className="btn sm"
              data-testid="diff-rollback"
              onClick={() => {
                setVerdict('rejected');
                props.onReview?.(props.path, false);
              }}
            >
              回滚
            </button>
          ) : null}
          {props.onOpenDiff ? (
            <button
              type="button"
              className="btn sm"
              data-testid="diff-open-all"
              onClick={() => {
                const abs = props.path.startsWith('/')
                  ? props.path
                  : resolveProjectEntryAbsolutePath(props.projectPath, props.path);
                props.onOpenDiff?.(abs, props.path);
              }}
            >
              全部差异 ↗
            </button>
          ) : null}
        </span>
      </div>
      {state.kind === 'loading' && (
        <div className="tool-body">
          <span className="dim">// 加载 diff…</span>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="tool-body">
          <span className="dim">// {state.message}</span>
        </div>
      )}
      {state.kind === 'ready' && state.fileDiff.isBinary && (
        <div className="tool-body">
          <span className="dim">// 二进制文件，无文本 diff</span>
        </div>
      )}
      {state.kind === 'ready' && !state.fileDiff.isBinary && (
        <CollapsibleContentBlock maxCollapsedHeight={140} defaultCollapsed={true}>
          <div className="diff-body dc-b">
            {lines.map((line, originalIndex) => {
              if (line.kind === 'meta') return null;
              if (line.kind === 'hunk') {
                return (
                  <div key={originalIndex} className="dl hk">
                    <span className="ln" />
                    <span className="ln-text dl-text">{line.text}</span>
                  </div>
                );
              }
              const nums = lineNumbers[originalIndex];
              const tokens: TokenLine | null = tokenMap?.get(originalIndex) ?? null;
              const lineNum =
                line.kind === 'del'
                  ? (nums?.old ?? '')
                  : (nums?.new ?? nums?.old ?? '');
              const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
              const lineClass =
                line.kind === 'add' ? 'dl a ln add' : line.kind === 'del' ? 'dl d ln del' : 'dl ln ctx';
              return (
                <div key={originalIndex} className={lineClass}>
                  <span className="g old ln" aria-hidden>
                    {lineNum}
                  </span>
                  <span className="ln-text dl-text">
                    <span className="dl-prefix" aria-hidden>{prefix} </span>
                    {tokens ? <TokenSpans tokens={tokens} /> : line.text}
                  </span>
                </div>
              );
            })}
            {state.fileDiff.truncated && (
              <div className="dl hk ln ctx">
                <span className="g old ln" />
                <span className="ln-text dl-text">diff 过长已截断</span>
              </div>
            )}
          </div>
        </CollapsibleContentBlock>
      )}
      {state.kind === 'ready' && !state.fileDiff.isBinary && (
        <div className="diff-footer dc-f" data-testid="diff-footer">
          <span>
            {verdict === 'accepted'
              ? `${totalChanges} 处修改 · 已接受`
              : verdict === 'rejected'
                ? `${totalChanges} 处修改 · 已回滚此文件`
                : `${totalChanges} 处修改 · 已写入磁盘 · 拒绝 = 回滚此文件`}
          </span>
          <span className="acts ml">
            {verdict === null ? (
              <>
                <button
                  type="button"
                  className="btn sm dan"
                  data-verdict="no"
                  onClick={() => {
                    setVerdict('rejected');
                    props.onReview?.(props.path, false);
                  }}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="btn sm pri"
                  data-verdict="ok"
                  onClick={() => {
                    setVerdict('accepted');
                    props.onReview?.(props.path, true);
                  }}
                >
                  接受
                </button>
              </>
            ) : verdict === 'accepted' ? (
              <span className="vd ok review-badge accepted">✓ 已接受</span>
            ) : (
              <span className="vd no review-badge rejected">已拒绝 · 已回滚</span>
            )}
          </span>
        </div>
      )}
    </div>
  );

  if (!diffTarget || !contextMenu) {
    return card;
  }
  return (
    <ContextMenuFromCatalog
      testId="diff-row-context-menu"
      target={diffTarget}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {card}
    </ContextMenuFromCatalog>
  );
}
