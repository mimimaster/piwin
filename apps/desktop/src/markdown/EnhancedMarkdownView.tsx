import { useMemo, type ReactElement } from 'react';
import { splitEnhancedMarkdownSegments } from './enhanced-markdown-segments.js';
import { EnhancedStreamdownContent } from './enhanced-markdown-streamdown';
import type { EnhancedMarkdownViewProps } from './enhanced-markdown-types.js';

export type { LineCommentItem, EnhancedMarkdownViewProps } from './enhanced-markdown-types.js';

/**
 * Review surface for a Markdown document. One renderer for every document:
 * the text is Markdown throughout, and a top-level `<details>` block becomes a
 * disclosure whose body is rendered the same way.
 */
export function EnhancedMarkdownView({
  text,
  docTitle,
  filePath,
  projectPath,
  onOpenFile,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
  lineOffset = 0,
}: EnhancedMarkdownViewProps & { lineOffset?: number }): ReactElement {
  const segments = useMemo(() => splitEnhancedMarkdownSegments(text), [text]);
  const shared = {
    docTitle,
    filePath,
    projectPath,
    onOpenFile,
    comments,
    onAddComment,
    onEditComment,
    onDeleteComment,
    onCommentLine,
  };

  return (
    <article
      className="enhanced-markdown-root" data-selectable
      data-testid="enhanced-markdown"
      {...(docTitle ? { 'aria-label': docTitle } : {})}
    >
      {segments.map((segment) =>
        segment.type === 'details' ? (
          <details className="enhanced-details" key={`details-${segment.startLine}`}>
            <summary className="enhanced-summary">{segment.summary}</summary>
            <div className="enhanced-details-content">
              <EnhancedMarkdownView
                {...shared}
                text={segment.content}
                lineOffset={lineOffset + segment.startLine + 1}
              />
            </div>
          </details>
        ) : (
          <EnhancedStreamdownContent
            {...shared}
            key={`markdown-${segment.startLine}`}
            text={segment.text}
            lineOffset={lineOffset + segment.startLine}
          />
        ),
      )}
    </article>
  );
}
