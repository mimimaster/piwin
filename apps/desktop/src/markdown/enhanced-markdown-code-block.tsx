import { useMemo, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { parseCodeReferenceFence } from './markdown-code-reference';
import { useHighlight, TokenSpans, normalizeLanguage, type TokenLine } from './syntax-highlight';
import { LineCommentWrapper } from './enhanced-markdown-comments';
import { CopyButton } from './enhanced-markdown-format';
import type { LineCommentItem } from './enhanced-markdown-types.js';

export function CodeBlockView({
  language,
  source,
  blockId,
  comments,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
}: {
  language: string;
  source: string;
  blockId?: string | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const lines = source.split('\n');
  const reference = parseCodeReferenceFence(language);
  const isDiff =
    language.toLowerCase() === 'diff' ||
    lines.some((l) => l.startsWith('+ ') || l.startsWith('- '));
  const FOLD_THRESHOLD = 16;
  const isLong = lines.length > FOLD_THRESHOLD;
  const visibleLines = isLong && !expanded ? lines.slice(0, FOLD_THRESHOLD) : lines;
  const visibleSource = useMemo(() => visibleLines.join('\n'), [visibleLines]);
  const highlightLang = isDiff ? 'diff' : normalizeLanguage(reference?.language ?? language);
  const tokenLines = useHighlight(visibleSource, highlightLang);

  return (
    <div className={`enhanced-code-block${isLong && !expanded ? ' folded' : ''}`} data-md-language={language}>
      <div className="enhanced-code-header">
        <span className="code-lang" {...(reference ? { title: reference.path } : {})}>
          {reference
            ? `${reference.path}:${reference.startLine}`
            : language || (isDiff ? 'diff' : 'code')}
        </span>
        <div className="code-header-actions">
          {isLong ? (
            <Button variant="ghost" size="compact" onClick={() => setExpanded((prev) => !prev)}>
              {expanded ? 'Collapse' : `Expand (${lines.length} lines)`}
            </Button>
          ) : null}
          <CopyButton text={source} />
        </div>
      </div>
      <div className="enhanced-code-body-wrapper">
        <pre className="enhanced-code">
          <code>
            {visibleLines.map((line, idx) => {
              const lineId = `${blockId ?? 'code'}-line-${idx}-${line.slice(0, 30)}`;
              const isAdd = line.startsWith('+');
              const isDel = line.startsWith('-');
              const lineClass = isAdd
                ? 'diff-line-add'
                : isDel
                  ? 'diff-line-delete'
                  : 'diff-line-context';
              const tokens: TokenLine | null = tokenLines?.[idx] ?? null;

              return (
                <LineCommentWrapper
                  key={idx}
                  lineId={lineId}
                  lineText={line}
                  comments={comments}
                  onAddComment={onAddComment}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
                  onCommentLine={onCommentLine}
                  className={`diff-line ${lineClass}`}
                >
                  <span className="code-line-num" aria-hidden>
                    {idx + 1}
                  </span>
                  <span className="code-line-text">
                    {tokens ? <TokenSpans tokens={tokens} /> : line}
                  </span>
                </LineCommentWrapper>
              );
            })}
          </code>
        </pre>
        {isLong && !expanded ? <div className="enhanced-code-fade" /> : null}
      </div>
    </div>
  );
}

