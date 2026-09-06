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

export function DiffCard(props: {
  projectPath: string;
  path: string;
  request: DiffCardRequest;
  onReview?: (path: string, ok: boolean) => void;
}): ReactElement {
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
      className={`diff-card${verdict === 'accepted' ? ' accepted' : ''}`}
      data-testid="diff-card"
    >
      <div className="diff-head">
        <span className="pc file" title={props.path}>
          <IconFile className="i s12" />
          <span>{props.path}</span>
        </span>
        <span className="stat num">
          {stats.adds > 0 && <span className="add">+{stats.adds}</span>}
          {stats.dels > 0 && <span className="del">−{stats.dels}</span>}
        </span>
        {verdict === null && state.kind === 'ready' ? (
          <div className="diff-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setVerdict('rejected');
                props.onReview?.(props.path, false);
              }}
            >
              拒绝
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setVerdict('accepted');
                props.onReview?.(props.path, true);
              }}
            >
              接受
            </button>
          </div>
        ) : verdict !== null ? (
          <span className={`review-badge ${verdict}`}>
            {verdict === 'accepted' ? '已接受' : '已拒绝'}
          </span>
        ) : null}
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
          <div className="diff-body">
            {lines.map((line, originalIndex) => {
              if (line.kind === 'meta' || line.kind === 'hunk') return null;
              const nums = lineNumbers[originalIndex];
              const tokens: TokenLine | null = tokenMap?.get(originalIndex) ?? null;
              return (
                <div
                  key={originalIndex}
                  className={`ln ${line.kind === 'add' ? 'add' : line.kind === 'del' ? 'del' : 'ctx'}`}
                >
                  <span className="g old" aria-hidden>
                    {nums?.old ?? ''}
                  </span>
                  <span className="g new" aria-hidden>
                    {nums?.new ?? ''}
                  </span>
                  <span className="ln-text">
                    {tokens ? <TokenSpans tokens={tokens} /> : line.text}
                  </span>
                </div>
              );
            })}
            {state.fileDiff.truncated && (
              <div className="ln ctx">
                <span className="g old" />
                <span className="g new" />
                <span className="ln-text">diff 过长已截断</span>
              </div>
            )}
          </div>
        </CollapsibleContentBlock>
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
