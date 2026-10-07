import { type ReactElement, type ReactNode } from 'react';
import { PathChip } from './path-chip';
import { MermaidBlock } from './MermaidBlock';
import { isMermaidFenceLanguage, isMathFenceLanguage } from './markdown-math';
import { MathView } from './markdown-math-view.js';
import { LineCommentWrapper } from './enhanced-markdown-comments';
import { CodeBlockView } from './enhanced-markdown-code-block';
import { DiffBadge, renderFormattedText } from './enhanced-markdown-format';
import { EnhancedMarkdownView } from './EnhancedMarkdownView';
import type {
  EnhancedBlock,
  LineCommentItem,
} from './enhanced-markdown-types.js';

export function HeadingElement({
  level,
  className,
  children,
}: {
  level: number;
  className: string;
  children: ReactNode;
}): ReactElement {
  switch (level) {
    case 1:
      return <h1 className={className}>{children}</h1>;
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
    case 5:
      return <h5 className={className}>{children}</h5>;
    default:
      return <h6 className={className}>{children}</h6>;
  }
}
export function EnhancedBlockView({
  blockIndex,
  block,
  docTitle,
  filePath,
  projectPath,
  onOpenFile,
  comments,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
}: {
  blockIndex: number;
  block: EnhancedBlock;
  docTitle?: string | undefined;
  filePath?: string | undefined;
  projectPath?: string | undefined;
  onOpenFile?: ((filePath: string) => void) | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
}): ReactElement {
  const blockLineId = `block-${blockIndex}-${block.type}`;
  // Chips inside legacy blocks share the same project context as the
  // Streamdown path, so Reveal / Save As can resolve relative paths.
  const renderText = (value: string): ReactNode =>
    renderFormattedText(value, onOpenFile, projectPath);

  if (block.type === 'heading') {
    const headingText = block.path || block.text;
    const headingLineId = `heading-${blockIndex}-${headingText.slice(0, 30)}`;

    if (block.action && block.path) {
      return (
        <LineCommentWrapper
          lineId={headingLineId}
          lineText={headingText}
          comments={comments}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onCommentLine={onCommentLine}
        >
          <div className={`enhanced-heading-diff level-${block.level}`}>
            <DiffBadge action={block.action} />
            <PathChip
              fullPath={block.path}
              className="diff-path"
              showIcon={true}
              {...(projectPath ? { projectPath } : {})}
              onOpen={() => onOpenFile?.(block.path!)}
            />
          </div>
        </LineCommentWrapper>
      );
    }

    const scopeMatch = /^(.*?)\s*\(([^)]+)\)$/.exec(block.text);
    if (scopeMatch && scopeMatch[1] && scopeMatch[2]) {
      return (
        <LineCommentWrapper
          lineId={headingLineId}
          lineText={headingText}
          comments={comments}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onCommentLine={onCommentLine}
        >
          <HeadingElement level={block.level} className={`enhanced-heading level-${block.level}`}>
            <span>{renderText(scopeMatch[1])}</span>
            <span className="heading-scope">({scopeMatch[2]})</span>
          </HeadingElement>
        </LineCommentWrapper>
      );
    }

    return (
      <LineCommentWrapper
        lineId={headingLineId}
        lineText={headingText}
        comments={comments}
        onAddComment={onAddComment}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onCommentLine={onCommentLine}
      >
        <HeadingElement level={block.level} className={`enhanced-heading level-${block.level}`}>
          {renderText(block.text)}
        </HeadingElement>
      </LineCommentWrapper>
    );
  }

  if (block.type === 'diff-header') {
    const diffLineId = `diff-${blockIndex}-${block.path}`;
    return (
      <LineCommentWrapper
        lineId={diffLineId}
        lineText={block.path}
        comments={comments}
        onAddComment={onAddComment}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onCommentLine={onCommentLine}
        className="enhanced-diff-header"
      >
        <DiffBadge action={block.action} />
        <PathChip
          fullPath={block.path}
          className="diff-path"
          showIcon={true}
          {...(projectPath ? { projectPath } : {})}
          onOpen={() => onOpenFile?.(block.path)}
        />
      </LineCommentWrapper>
    );
  }

  if (block.type === 'details') {
    return (
      <details className="enhanced-details">
        <summary className="enhanced-summary">{block.summary}</summary>
        <div className="enhanced-details-content">
          <EnhancedMarkdownView
            text={block.content}
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
        </div>
      </details>
    );
  }

  if (block.type === 'code') {
    if (isMermaidFenceLanguage(block.language)) {
      return <MermaidBlock source={block.source} />;
    }
    if (isMathFenceLanguage(block.language)) {
      return <MathView tex={block.source} display className="enhanced-math-display" />;
    }
    return (
      <CodeBlockView
        language={block.language}
        source={block.source}
        comments={comments}
        onAddComment={onAddComment}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onCommentLine={onCommentLine}
      />
    );
  }

  if (block.type === 'callout') {
    return (
      <LineCommentWrapper
        lineId={`callout-${blockIndex}`}
        lineText={block.text}
        comments={comments}
        onAddComment={onAddComment}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onCommentLine={onCommentLine}
        className={`enhanced-callout callout-${block.kind}`}
      >
        <div className="callout-title">{block.kind.toUpperCase()}</div>
        <div className="callout-content">{renderText(block.text)}</div>
      </LineCommentWrapper>
    );
  }

  if (block.type === 'list' || block.type === 'ordered-list') {
    const ListTag = block.type === 'ordered-list' ? 'ol' : 'ul';
    const listClass =
      block.type === 'ordered-list' ? 'enhanced-list enhanced-ordered-list' : 'enhanced-list';
    return (
      <ListTag className={listClass}>
        {block.items.map((item, index) => {
          const listLineId = `list-${blockIndex}-${index}-${item.text.slice(0, 30)}`;
          return (
            <LineCommentWrapper
              as="li"
              key={index}
              lineId={listLineId}
              lineText={item.text}
              comments={comments}
              onAddComment={onAddComment}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              onCommentLine={onCommentLine}
              className="enhanced-list-item"
            >
              <div className="item-text">
                {item.checked !== undefined ? (
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    className="enhanced-checkbox"
                  />
                ) : null}
                <span>{renderText(item.text)}</span>
              </div>
              {item.subItems && item.subItems.length > 0 ? (
                <ul className="enhanced-sub-list">
                  {item.subItems.map((sub, subIndex) => (
                    <li key={subIndex} className="enhanced-sub-item">
                      <span>{renderText(sub)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </LineCommentWrapper>
          );
        })}
      </ListTag>
    );
  }

  if (block.type === 'blockquote') {
    return (
      <LineCommentWrapper
        lineId={`quote-${blockIndex}`}
        lineText={block.text}
        comments={comments}
        onAddComment={onAddComment}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        onCommentLine={onCommentLine}
        className="enhanced-blockquote"
      >
        <blockquote>{renderText(block.text)}</blockquote>
      </LineCommentWrapper>
    );
  }

  function getTextAlign(
    alignment?: 'left' | 'center' | 'right' | 'default',
  ): 'left' | 'center' | 'right' | undefined {
    if (!alignment || alignment === 'default') return undefined;
    return alignment;
  }

  if (block.type === 'hr') {
    return <hr className="enhanced-hr" />;
  }

  if (block.type === 'table') {
    return (
      <div className="md-table-wrapper" data-testid="enhanced-md-table">
        <table className="md-table">
          <thead>
            <tr>
              {block.headers.map((header, hIdx) => (
                <th key={hIdx} style={{ textAlign: getTextAlign(block.alignments[hIdx]) }}>
                  {renderText(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} style={{ textAlign: getTextAlign(block.alignments[cIdx]) }}>
                    {renderText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <LineCommentWrapper
      lineId={blockLineId}
      lineText={block.text}
      comments={comments}
      onAddComment={onAddComment}
      onEditComment={onEditComment}
      onDeleteComment={onDeleteComment}
      onCommentLine={onCommentLine}
      className="enhanced-paragraph-row"
    >
      <p className="enhanced-paragraph">{renderText(block.text)}</p>
    </LineCommentWrapper>
  );
}

