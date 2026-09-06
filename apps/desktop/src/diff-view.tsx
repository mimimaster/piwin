/**
 * Unified / side-by-side patch renderer for Review (VS Code SCM style).
 * Enhanced with per-file Accept / Reject actions (Cursor-style inline review).
 */
import { useMemo, useState, type ReactElement } from 'react';
import {
  computeDiffLineNumbers,
  computeOmittedLineCounts,
  type DiffLineNumbers,
} from './diff-line-numbers';
import {
  useHighlightLines,
  languageFromPath,
  TokenSpans,
  type TokenLine,
} from './syntax-highlight';

export type DiffViewMode = 'unified' | 'split';

export type DiffAction = 'accept' | 'reject';

export type DiffViewProps = {
  patch: string;
  mode: DiffViewMode;
  path?: string;
  isBinary?: boolean;
  truncated?: boolean;
  emptyMessage?: string;
  /** When true, omits the internal path header (useful when a wrapper provides its own chrome). */
  hideHeader?: boolean;
  /** Omits raw git prelude lines when the surrounding view already identifies the file. */
  hideMetadata?: boolean;
  /** Localizes compact hunk summaries. */
  locale?: 'zh-CN' | 'en' | undefined;
  /** When provided, renders Accept / Reject action bar. */
  onAction?: (action: DiffAction, path?: string) => void;
  /** Current review state for this file. */
  reviewState?: 'pending' | 'accepted' | 'rejected';
};

export type ParsedDiffLine = {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'del' | 'blank';
  text: string;
};

export function isHighlightableDiffLine(line: ParsedDiffLine): boolean {
  return line.kind === 'context' || line.kind === 'add' || line.kind === 'del';
}

export function selectUnifiedLineNumber(
  line: ParsedDiffLine,
  numbers: DiffLineNumbers | undefined,
): number | null {
  if (!numbers) return null;
  if (line.kind === 'del') return numbers.old;
  if (line.kind === 'add' || line.kind === 'context') return numbers.new;
  return null;
}

export function parseUnifiedDiff(patch: string): ParsedDiffLine[] {
  if (!patch.trim()) return [];
  return patch.split('\n').map((line) => {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ')
    ) {
      return { kind: 'meta' as const, text: line };
    }
    if (line.startsWith('@@')) {
      return { kind: 'hunk' as const, text: line };
    }
    if (line.startsWith('+')) {
      return { kind: 'add' as const, text: line.slice(1) };
    }
    if (line.startsWith('-')) {
      return { kind: 'del' as const, text: line.slice(1) };
    }
    if (line.startsWith(' ')) {
      return { kind: 'context' as const, text: line.slice(1) };
    }
    if (line === '') {
      return { kind: 'blank' as const, text: '' };
    }
    return { kind: 'context' as const, text: line };
  });
}

type SplitRow = {
  left: { kind: 'context' | 'del' | 'empty'; text: string } | null;
  right: { kind: 'context' | 'add' | 'empty'; text: string } | null;
};

export function buildSplitRows(lines: ParsedDiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.kind === 'meta' || line.kind === 'hunk' || line.kind === 'blank') {
      index += 1;
      continue;
    }
    if (line.kind === 'context') {
      rows.push({
        left: { kind: 'context', text: line.text },
        right: { kind: 'context', text: line.text },
      });
      index += 1;
      continue;
    }
    if (line.kind === 'del') {
      const dels: string[] = [];
      while (index < lines.length && lines[index]?.kind === 'del') {
        dels.push(lines[index]!.text);
        index += 1;
      }
      const adds: string[] = [];
      while (index < lines.length && lines[index]?.kind === 'add') {
        adds.push(lines[index]!.text);
        index += 1;
      }
      const max = Math.max(dels.length, adds.length);
      for (let rowIndex = 0; rowIndex < max; rowIndex += 1) {
        rows.push({
          left:
            rowIndex < dels.length
              ? { kind: 'del', text: dels[rowIndex]! }
              : { kind: 'empty', text: '' },
          right:
            rowIndex < adds.length
              ? { kind: 'add', text: adds[rowIndex]! }
              : { kind: 'empty', text: '' },
        });
      }
      continue;
    }
    if (line.kind === 'add') {
      rows.push({
        left: { kind: 'empty', text: '' },
        right: { kind: 'add', text: line.text },
      });
      index += 1;
    }
  }
  return rows;
}

export function DiffView(props: DiffViewProps): ReactElement {
  const lines = useMemo(() => parseUnifiedDiff(props.patch), [props.patch]);
  const splitRows = useMemo(() => buildSplitRows(lines), [lines]);
  const lineNumbers = useMemo(() => computeDiffLineNumbers(lines), [lines]);
  const omittedLineCounts = useMemo(() => computeOmittedLineCounts(lines), [lines]);
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
  const tokensByText = useMemo(() => {
    const map = new Map<string, TokenLine>();
    if (!tokenMap) return map;
    for (let index = 0; index < contentTexts.length; index += 1) {
      const text = contentTexts[index];
      const tokens = tokenMap.get(index);
      if (text && tokens && tokens.length > 0 && !map.has(text)) map.set(text, tokens);
    }
    return map;
  }, [tokenMap, contentTexts]);
  const [localReview, setLocalReview] = useState<'pending' | 'accepted' | 'rejected'>(
    props.reviewState ?? 'pending',
  );

  if (props.isBinary) {
    return (
      <div className="diff-view empty muted" data-testid="diff-view">
        Binary file — no text diff
      </div>
    );
  }
  if (!props.patch.trim()) {
    return (
      <div className="diff-view empty muted" data-testid="diff-view">
        {props.emptyMessage ?? 'Select a changed file to review the patch'}
      </div>
    );
  }

  const reviewState = props.reviewState ?? localReview;
  const showActions = typeof props.onAction === 'function';

  function handleAction(action: DiffAction): void {
    setLocalReview(action === 'accept' ? 'accepted' : 'rejected');
    props.onAction?.(action, props.path);
  }

  return (
    <div
      className={`diff-view${reviewState !== 'pending' ? ` reviewed-${reviewState}` : ''}`}
      data-testid="diff-view"
      data-mode={props.mode}
      data-review={reviewState}
    >
      {props.path && !props.hideHeader ? (
        <header className="diff-view-header">
          <code>{props.path}</code>
          <span className="diff-view-header-right">
            {props.truncated ? <span className="muted">truncated</span> : null}
            {reviewState === 'accepted' ? (
              <span className="diff-review-badge accepted">Accepted</span>
            ) : null}
            {reviewState === 'rejected' ? (
              <span className="diff-review-badge rejected">Rejected</span>
            ) : null}
          </span>
        </header>
      ) : null}

      {/* Accept / Reject action bar */}
      {showActions && reviewState === 'pending' ? (
        <div className="diff-action-bar" data-testid="diff-action-bar">
          <button
            type="button"
            className="diff-action-btn accept"
            onClick={() => handleAction('accept')}
          >
            <svg
              viewBox="0 0 16 16"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m3 8.5 3.5 3.5L13 5" />
            </svg>
            Accept
          </button>
          <button
            type="button"
            className="diff-action-btn reject"
            onClick={() => handleAction('reject')}
          >
            <svg
              viewBox="0 0 16 16"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
            Reject
          </button>
        </div>
      ) : null}

      {props.mode === 'unified' ? (
        <pre className="diff-unified">
          {lines.map((line, lineIndex) => {
            if (props.hideMetadata && line.kind === 'meta') return null;
            const nums = lineNumbers[lineIndex];
            const lineNumber = selectUnifiedLineNumber(line, nums);
            const omittedLineCount = omittedLineCounts[lineIndex];
            if (line.kind === 'hunk') {
              if (!omittedLineCount) return null;
              const omittedLineLabel =
                props.locale === 'zh-CN'
                  ? `未修改 ${omittedLineCount} 行`
                  : `${omittedLineCount} unmodified lines`;
              return (
                <div
                  key={`${line.kind}-${lineIndex}`}
                  className="diff-line kind-hunk"
                  role="separator"
                  aria-label={omittedLineLabel}
                >
                  <span className="diff-hunk-marker" aria-hidden>
                    …
                  </span>
                  <span className="diff-hunk-summary">{omittedLineLabel}</span>
                </div>
              );
            }
            const tokens = isHighlightableDiffLine(line)
              ? (tokenMap?.get(lineIndex) ?? null)
              : null;
            return (
              <div key={`${line.kind}-${lineIndex}`} className={`diff-line kind-${line.kind}`}>
                <span
                  className="diff-lineno"
                  data-line-source={
                    line.kind === 'del'
                      ? 'old'
                      : line.kind === 'add' || line.kind === 'context'
                        ? 'new'
                        : undefined
                  }
                  aria-hidden
                >
                  {lineNumber ?? ''}
                </span>
                <span className="diff-gutter" aria-hidden>
                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                </span>
                <span className="diff-text">
                  {tokens && tokens.length > 0 ? <TokenSpans tokens={tokens} /> : line.text}
                </span>
              </div>
            );
          })}
        </pre>
      ) : (
        <div className="diff-split">
          <div className="diff-split-col" aria-label={props.locale === 'zh-CN' ? '原文' : 'Original'}>
            {splitRows.map((row, rowIndex) => (
              <div key={`l-${rowIndex}`} className={`diff-line kind-${row.left?.kind ?? 'empty'}`}>
                <span className="diff-text">
                  {row.left && tokensByText.get(row.left.text) ? (
                    <TokenSpans tokens={tokensByText.get(row.left.text)!} />
                  ) : (
                    (row.left?.text ?? '')
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="diff-split-col" aria-label={props.locale === 'zh-CN' ? '修改后' : 'Modified'}>
            {splitRows.map((row, rowIndex) => (
              <div key={`r-${rowIndex}`} className={`diff-line kind-${row.right?.kind ?? 'empty'}`}>
                <span className="diff-text">
                  {row.right && tokensByText.get(row.right.text) ? (
                    <TokenSpans tokens={tokensByText.get(row.right.text)!} />
                  ) : (
                    (row.right?.text ?? '')
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
