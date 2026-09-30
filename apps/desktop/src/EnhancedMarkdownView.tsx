import type { ReactElement } from 'react';
import { parseEnhancedMarkdownBlocks } from './enhanced-markdown-blocks.js';
import { EnhancedBlockView } from './enhanced-markdown-legacy';
import { EnhancedStreamdownContent } from './enhanced-markdown-streamdown';
import type { EnhancedMarkdownViewProps } from './enhanced-markdown-types.js';

export type { LineCommentItem, EnhancedMarkdownViewProps } from './enhanced-markdown-types.js';

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
}: EnhancedMarkdownViewProps): ReactElement {
  const useLegacyReviewRenderer = shouldUseLegacyReviewRenderer(text);
  const blocks = useLegacyReviewRenderer ? parseEnhancedMarkdownBlocks(text) : [];

  return (
    <article
      className="enhanced-markdown-root" data-selectable
      data-testid="enhanced-markdown"
      {...(docTitle ? { 'aria-label': docTitle } : {})}
    >
      {useLegacyReviewRenderer ? (
        blocks.map((block, index) => (
          <EnhancedBlockView
            key={index}
            blockIndex={index}
            block={block}
            docTitle={docTitle}
            filePath={filePath}
            projectPath={projectPath}
            onOpenFile={onOpenFile}
            comments={comments}
            onAddComment={onAddComment}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            onCommentLine={onCommentLine}
          />
        ))
      ) : (
        <EnhancedStreamdownContent
          text={text}
          docTitle={docTitle}
          filePath={filePath}
          projectPath={projectPath}
          onOpenFile={onOpenFile}
          comments={comments}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onCommentLine={onCommentLine}
        />
      )}
    </article>
  );
}

function shouldUseLegacyReviewRenderer(text: string): boolean {
  return (
    /<details\b/i.test(text) ||
    /^\s*(?:#{1,6}\s+)?\[(MODIFY|NEW|DELETE|RENAME)\]/im.test(text)
  );
}
