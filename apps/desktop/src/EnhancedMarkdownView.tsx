import {
  cloneElement,
  isValidElement,
  useMemo,
  useState,
  type ComponentProps,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';
import { Button } from '@piwin/ui-kit';
import { Streamdown, type Components, type ExtraProps } from 'streamdown';
import { PathChip } from './path-chip';
import { MermaidBlock } from './MermaidBlock';
import { escapeRawHtmlInMarkdown } from './markdown-html-escape';
import { renderKatex, isMermaidFenceLanguage, isMathFenceLanguage } from './markdown-math';
import { IconCommentAction } from './shell-icons';
import { useHighlight, TokenSpans, normalizeLanguage, type TokenLine } from './syntax-highlight';

export type LineCommentItem = {
  id: string;
  lineId: string;
  lineText: string;
  commentText: string;
};

export type EnhancedMarkdownViewProps = {
  text: string;
  docTitle?: string | undefined;
  filePath?: string | undefined;
  onOpenFile?: ((filePath: string) => void) | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
};

export function EnhancedMarkdownView({
  text,
  docTitle,
  filePath,
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
      className="enhanced-markdown-root"
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

const ENHANCED_STREAMDOWN_PLUGINS = {
  cjk,
  math: createMathPlugin({ singleDollarTextMath: false }),
};
const ENHANCED_LINK_SAFETY = { enabled: false };

type EnhancedStreamdownContentProps = Omit<EnhancedMarkdownViewProps, 'text'> & {
  text: string;
};

type EnhancedStreamdownElementProps<Tag extends keyof JSX.IntrinsicElements> = ComponentProps<Tag> &
  ExtraProps;

type EnhancedStreamdownCodeProps = EnhancedStreamdownElementProps<'code'> & {
  'data-block'?: boolean | string;
};

function enhancedPlainText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(enhancedPlainText).join('');
  if (isValidElement(value)) {
    const element = value as ReactElement<{ children?: ReactNode }>;
    return enhancedPlainText(element.props.children);
  }
  return '';
}

function enhancedLineId(kind: string, node: ExtraProps['node'], text: string): string {
  const line = node?.position?.start.line ?? 0;
  return `${kind}-${line}-${text.slice(0, 40)}`;
}

function isEnhancedDocumentPath(value: string): boolean {
  return (
    /(?:^|\/|[A-Za-z]:[\\/])[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.[a-zA-Z0-9]+$/i.test(value) ||
    /^\/[a-zA-Z0-9_\u4e00-\u9fa5.-]+(?:\/[a-zA-Z0-9_\u4e00-\u9fa5.-]+)+\/$/i.test(value) ||
    /^[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.(?:ts|tsx|js|jsx|py|json|css|scss|md|html|rs|go|sh|png|jpg|svg)$/i.test(
      value,
    )
  );
}

function EnhancedStreamdownContent({
  text,
  docTitle,
  filePath,
  onOpenFile,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
}: EnhancedStreamdownContentProps): ReactElement {
  const escapedText = useMemo(() => escapeRawHtmlInMarkdown(text), [text]);
  const components = useMemo(
    () =>
      createEnhancedStreamdownComponents({
        docTitle,
        filePath,
        onOpenFile,
        comments,
        onAddComment,
        onEditComment,
        onDeleteComment,
        onCommentLine,
      }),
    [
      docTitle,
      filePath,
      onOpenFile,
      comments,
      onAddComment,
      onEditComment,
      onDeleteComment,
      onCommentLine,
    ],
  );

  return (
    <Streamdown
      className="enhanced-markdown-streamdown"
      mode="static"
      parseIncompleteMarkdown={false}
      plugins={ENHANCED_STREAMDOWN_PLUGINS}
      components={components}
      controls={false}
      lineNumbers={false}
      skipHtml
      linkSafety={ENHANCED_LINK_SAFETY}
    >
      {escapedText}
    </Streamdown>
  );
}

type EnhancedStreamdownRendererOptions = {
  docTitle: string | undefined;
  filePath: string | undefined;
  onOpenFile: ((filePath: string) => void) | undefined;
  comments: LineCommentItem[];
  onAddComment:
    | ((comment: { lineId: string; lineText: string; commentText: string }) => void)
    | undefined;
  onEditComment: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment: ((id: string) => void) | undefined;
  onCommentLine: ((lineContent: string) => void) | undefined;
};

function createEnhancedStreamdownComponents(
  options: EnhancedStreamdownRendererOptions,
): Components {
  const wrapReviewLine = (
    kind: string,
    node: ExtraProps['node'],
    lineText: string,
    children: ReactNode,
    className?: string,
    as: 'div' | 'li' = 'div',
  ): ReactElement => (
    <LineCommentWrapper
      as={as}
      lineId={enhancedLineId(kind, node, lineText)}
      lineText={lineText}
      comments={options.comments}
      onAddComment={options.onAddComment}
      onEditComment={options.onEditComment}
      onDeleteComment={options.onDeleteComment}
      onCommentLine={options.onCommentLine}
      {...(className ? { className } : {})}
    >
      {children}
    </LineCommentWrapper>
  );

  const renderParagraph = ({
    children,
    node,
  }: EnhancedStreamdownElementProps<'p'>): ReactElement => {
    const lineText = enhancedPlainText(children);
    return wrapReviewLine(
      'paragraph',
      node,
      lineText,
      <p className="enhanced-paragraph">{children}</p>,
      'enhanced-paragraph-row',
    );
  };

  const renderHeading = (level: number) =>
    ({ children, node }: EnhancedStreamdownElementProps<'h1'>): ReactElement => {
      const headingText = enhancedPlainText(children);
      const scopeMatch = /^(.*?)\s*\(([^)]+)\)$/.exec(headingText);
      const headingContent =
        scopeMatch && typeof children === 'string' ? children.slice(0, scopeMatch[1]?.length) : children;
      const heading = scopeMatch ? (
        <HeadingElement level={level} className={`enhanced-heading level-${level}`}>
          <span>{headingContent}</span>
          <span className="heading-scope">({scopeMatch[2]})</span>
        </HeadingElement>
      ) : (
        <HeadingElement level={level} className={`enhanced-heading level-${level}`}>
          {children}
        </HeadingElement>
      );
      return wrapReviewLine('heading', node, headingText, heading);
    };

  const renderList = ({ children }: EnhancedStreamdownElementProps<'ul'>, ordered: boolean): ReactElement => {
    const ListTag = ordered ? 'ol' : 'ul';
    return <ListTag className={ordered ? 'enhanced-list enhanced-ordered-list' : 'enhanced-list'}>{children}</ListTag>;
  };

  const renderListItem = ({
    children,
    node,
  }: EnhancedStreamdownElementProps<'li'>): ReactElement => {
    const lineText = enhancedPlainText(children);
    return wrapReviewLine(
      'list',
      node,
      lineText,
      <div className="item-text">{children}</div>,
      'enhanced-list-item',
      'li',
    );
  };

  const renderBlockquote = ({
    children,
    node,
  }: EnhancedStreamdownElementProps<'blockquote'>): ReactElement => {
    const lineText = enhancedPlainText(children);
    return wrapReviewLine(
      'quote',
      node,
      lineText,
      <blockquote>{children}</blockquote>,
      'enhanced-blockquote',
    );
  };

  const renderTable = ({ children }: EnhancedStreamdownElementProps<'table'>): ReactElement => (
    <div className="md-table-wrapper" data-testid="enhanced-md-table">
      <table className="md-table">{children}</table>
    </div>
  );

  const renderTableCell = ({
    children,
    align,
    style,
    node: _node,
    ...props
  }: EnhancedStreamdownElementProps<'th'>): ReactElement => {
    const textAlign = align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    return <th {...props} style={textAlign ? { ...style, textAlign } : style}>{children}</th>;
  };

  const renderTableDataCell = ({
    children,
    align,
    style,
    node: _node,
    ...props
  }: EnhancedStreamdownElementProps<'td'>): ReactElement => {
    const textAlign = align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    return <td {...props} style={textAlign ? { ...style, textAlign } : style}>{children}</td>;
  };

  const renderCode = ({
    children,
    className,
    node,
    'data-block': dataBlock,
  }: EnhancedStreamdownCodeProps): ReactElement => {
    const source = enhancedPlainText(children).replace(/\n$/, '');
    if (dataBlock === undefined) {
      if (isEnhancedDocumentPath(source.trim()) && options.onOpenFile) {
        return (
          <PathChip
            fullPath={source.trim()}
            showIcon={false}
            onOpen={() => options.onOpenFile?.(source.trim())}
          />
        );
      }
      return <code className="enhanced-inline-code">{children}</code>;
    }

    const languageMatch = /(?:^|\s)language-([A-Za-z0-9_-]+)/.exec(className ?? '');
    const language = languageMatch?.[1] ?? '';
    const lineText = source || language || 'code';
    const lineId = enhancedLineId('code', node, lineText);
    if (isMermaidFenceLanguage(language)) {
      return wrapReviewLine(
        'code',
        node,
        lineText,
        <MermaidBlock source={source} />,
      );
    }
    if (isMathFenceLanguage(language)) {
      const katexResult = renderKatex(source, true);
      return wrapReviewLine(
        'code',
        node,
        lineText,
        katexResult.ok ? (
          <div className="enhanced-math-display" dangerouslySetInnerHTML={{ __html: katexResult.html }} />
        ) : (
          <pre className="enhanced-code"><code>{source}</code></pre>
        ),
      );
    }
    return (
      <CodeBlockView
        language={language}
        source={source}
        comments={options.comments}
        onAddComment={options.onAddComment}
        onEditComment={options.onEditComment}
        onDeleteComment={options.onDeleteComment}
        onCommentLine={options.onCommentLine}
        blockId={lineId}
      />
    );
  };

  const renderAnchor = ({
    children,
    href,
    node: _node,
  }: EnhancedStreamdownElementProps<'a'>): ReactElement => {
    const url = href ?? '';
    const label = enhancedPlainText(children).trim() || 'Document';
    const normalizedUrl = url.split('#', 1)[0]?.split('?', 1)[0]?.toLowerCase() ?? '';
    if (options.onOpenFile && normalizedUrl.endsWith('.md')) {
      return (
        <PathChip
          fullPath={url}
          label={label}
          showIcon={false}
          onOpen={() => options.onOpenFile?.(url)}
        />
      );
    }
    return (
      <a href={url} className="enhanced-link" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };

  const renderInput = ({
    node: _node,
    className,
    ...props
  }: EnhancedStreamdownElementProps<'input'>): ReactElement => (
    <input
      {...props}
      type={props.type ?? 'checkbox'}
      disabled
      className={className ? `enhanced-checkbox ${className}` : 'enhanced-checkbox'}
    />
  );

  return {
    p: renderParagraph,
    h1: renderHeading(1),
    h2: renderHeading(2),
    h3: renderHeading(3),
    h4: renderHeading(4),
    h5: renderHeading(5),
    h6: renderHeading(6),
    ul: (props) => renderList(props, false),
    ol: (props) => renderList(props, true),
    li: renderListItem,
    blockquote: renderBlockquote,
    table: renderTable,
    th: renderTableCell,
    td: renderTableDataCell,
    code: renderCode,
    pre: ({ children, node: _node }: EnhancedStreamdownElementProps<'pre'>) =>
      isValidElement<EnhancedStreamdownCodeProps>(children)
        ? cloneElement(children, { 'data-block': 'true' })
        : <>{children}</>,
    a: renderAnchor,
    input: renderInput,
    strong: ({ children, node: _node }: EnhancedStreamdownElementProps<'strong'>) => (
      <strong className="enhanced-strong">{children}</strong>
    ),
    em: ({ children, node: _node, className, ...props }: EnhancedStreamdownElementProps<'em'>) => (
      <em {...props} className={className ? `enhanced-em ${className}` : 'enhanced-em'}>
        {children}
      </em>
    ),
  };
}

type DiffActionType = 'MODIFY' | 'NEW' | 'DELETE' | 'RENAME';

type EnhancedBlock =
  | {
      type: 'heading';
      level: number;
      text: string;
      action?: DiffActionType | undefined;
      ext?: string | undefined;
      path?: string | undefined;
    }
  | {
      type: 'diff-header';
      action: DiffActionType;
      ext?: string | undefined;
      path: string;
      description?: string | undefined;
    }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: EnhancedListItem[] }
  | { type: 'ordered-list'; items: EnhancedListItem[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language: string; source: string }
  | { type: 'details'; summary: string; content: string }
  | { type: 'callout'; kind: 'note' | 'tip' | 'important' | 'warning' | 'caution'; text: string }
  | { type: 'hr' }
  | {
      type: 'table';
      headers: string[];
      alignments: ('left' | 'center' | 'right' | 'default')[];
      rows: string[][];
    };

type EnhancedListItem = {
  text: string;
  checked?: boolean | undefined;
  subItems?: string[] | undefined;
};

function parseTableRow(line: string): string[] {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);
  return content.split('|').map((cell) => cell.trim());
}

function parseTableAlignment(delimiterCell: string): 'left' | 'center' | 'right' | 'default' {
  const cell = delimiterCell.trim();
  const starts = cell.startsWith(':');
  const ends = cell.endsWith(':');
  if (starts && ends) return 'center';
  if (ends) return 'right';
  if (starts) return 'left';
  return 'default';
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(trimmed);
}

function parseEnhancedMarkdownBlocks(text: string): EnhancedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: EnhancedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Horizontal Rule dividers (---, ***, ___, -----, etc.)
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Fenced code blocks
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({
        type: 'code',
        language,
        source: codeLines.join('\n'),
      });
      continue;
    }

    // HTML <details><summary> blocks
    if (trimmed.toLowerCase().startsWith('<details')) {
      let summaryText = 'Details';
      const detailLines: string[] = [];
      const inlineSummaryMatch = /<summary>(.*?)<\/summary>/i.exec(line);
      if (inlineSummaryMatch && inlineSummaryMatch[1]) {
        summaryText = inlineSummaryMatch[1].trim();
      }
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const curTrimmed = cur.trim();
        if (curTrimmed.toLowerCase().startsWith('</details>')) {
          i++;
          break;
        }
        const sumMatch = /<summary>(.*?)<\/summary>/i.exec(cur);
        if (sumMatch && sumMatch[1]) {
          summaryText = sumMatch[1].trim();
        } else if (
          !curTrimmed.toLowerCase().startsWith('<summary') &&
          !curTrimmed.toLowerCase().startsWith('</summary')
        ) {
          detailLines.push(cur);
        }
        i++;
      }
      blocks.push({
        type: 'details',
        summary: summaryText,
        content: detailLines.join('\n'),
      });
      continue;
    }

    // Tables
    if (trimmed.includes('|') && i + 1 < lines.length && isTableDelimiterLine(lines[i + 1] ?? '')) {
      const headers = parseTableRow(line);
      const delimiterCells = parseTableRow(lines[i + 1] ?? '');
      const alignments = delimiterCells.map(parseTableAlignment);
      i += 2;

      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').trim() !== '' &&
        !(lines[i] ?? '').trim().startsWith('```') &&
        (lines[i] ?? '').includes('|')
      ) {
        rows.push(parseTableRow(lines[i] ?? ''));
        i++;
      }
      blocks.push({ type: 'table', headers, alignments, rows });
      continue;
    }

    // Callouts (> [!NOTE])
    if (trimmed.startsWith('> [!')) {
      const match = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(trimmed);
      if (match && match[1]) {
        const kind = match[1].toLowerCase() as 'note' | 'tip' | 'important' | 'warning' | 'caution';
        const calloutLines: string[] = [];
        i++;
        while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
          calloutLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
          i++;
        }
        blocks.push({
          type: 'callout',
          kind,
          text: calloutLines.join('\n'),
        });
        continue;
      }
    }

    // Headings (#, ##, ###, ####)
    if (trimmed.startsWith('#')) {
      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        const level = headingMatch[1].length;
        const rawContent = headingMatch[2].trim();

        const diffMatch =
          /^\[(MODIFY|NEW|DELETE|RENAME)\]\s*(?:(?:`?([A-Za-z0-9_-]+)`?|\[([A-Za-z0-9_-]+)\])\s+)?(.*)$/i.exec(
            rawContent,
          );
        if (diffMatch && diffMatch[1]) {
          const action = diffMatch[1].toUpperCase() as DiffActionType;
          let ext = diffMatch[2] || diffMatch[3] || '';
          let path = diffMatch[4] || '';

          const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(path);
          if (linkMatch && linkMatch[1]) {
            path = linkMatch[1];
          }

          if (!ext && path) {
            const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
            if (extMatch && extMatch[1]) {
              ext = extMatch[1].toUpperCase();
            }
          }

          blocks.push({
            type: 'heading',
            level,
            text: rawContent,
            action,
            ext: ext ? ext.toUpperCase() : undefined,
            path,
          });
        } else {
          blocks.push({
            type: 'heading',
            level,
            text: rawContent,
          });
        }
        i++;
        continue;
      }
    }

    // Standalone Diff items
    const standaloneDiffMatch =
      /^\[(MODIFY|NEW|DELETE|RENAME)\]\s*(?:(?:`?([A-Za-z0-9_-]+)`?|\[([A-Za-z0-9_-]+)\])\s+)?(.*)$/i.exec(
        trimmed,
      );
    if (standaloneDiffMatch && standaloneDiffMatch[1]) {
      const action = standaloneDiffMatch[1].toUpperCase() as DiffActionType;
      let ext = standaloneDiffMatch[2] || standaloneDiffMatch[3] || '';
      let path = standaloneDiffMatch[4] || '';

      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(path);
      if (linkMatch && linkMatch[1]) {
        path = linkMatch[1];
      }

      if (!ext && path) {
        const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
        if (extMatch && extMatch[1]) {
          ext = extMatch[1].toUpperCase();
        }
      }

      blocks.push({
        type: 'diff-header',
        action,
        ext: ext ? ext.toUpperCase() : undefined,
        path,
      });
      i++;
      continue;
    }

    // Bullet lists (- or *)
    if (/^[-*]\s+/.test(trimmed)) {
      const items: EnhancedListItem[] = [];
      while (i < lines.length) {
        const currentLine = lines[i] ?? '';
        const currentTrimmed = currentLine.trim();

        const itemMatch = /^[-*]\s+(.*)$/.exec(currentTrimmed);
        if (itemMatch && itemMatch[1]) {
          const itemText = itemMatch[1];
          const checkMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
          let checked: boolean | undefined;
          let cleanText = itemText;
          if (checkMatch && checkMatch[1] !== undefined && checkMatch[2] !== undefined) {
            checked = checkMatch[1].toLowerCase() === 'x';
            cleanText = checkMatch[2];
          }

          const subItems: string[] = [];
          i++;

          while (i < lines.length) {
            const nextLine = lines[i] ?? '';
            const nextTrimmed = nextLine.trim();
            if (
              /^\s+[-*]\s+/.test(nextLine) ||
              (nextLine.startsWith('  ') && /^[-*]\s+/.test(nextTrimmed))
            ) {
              const subMatch = /^[-*]\s+(.*)$/.exec(nextTrimmed);
              if (subMatch && subMatch[1]) {
                subItems.push(subMatch[1]);
              }
              i++;
            } else {
              break;
            }
          }

          items.push({
            text: cleanText,
            ...(checked !== undefined ? { checked } : {}),
            ...(subItems.length > 0 ? { subItems } : {}),
          });
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Ordered lists (1. 2. …)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: EnhancedListItem[] = [];
      while (i < lines.length) {
        const currentTrimmed = (lines[i] ?? '').trim();
        const itemMatch = /^(\d+)\.\s+(.*)$/.exec(currentTrimmed);
        if (!itemMatch || itemMatch[2] === undefined) break;
        const itemText = itemMatch[2];
        const checkMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
        let checked: boolean | undefined;
        let cleanText = itemText;
        if (checkMatch?.[1] !== undefined && checkMatch[2] !== undefined) {
          checked = checkMatch[1].toLowerCase() === 'x';
          cleanText = checkMatch[2];
        }
        const subItems: string[] = [];
        i++;
        while (i < lines.length) {
          const nextLine = lines[i] ?? '';
          const nextTrimmed = nextLine.trim();
          if (
            /^\s+[-*]\s+/.test(nextLine) ||
            (nextLine.startsWith('  ') && /^[-*]\s+/.test(nextTrimmed))
          ) {
            const subMatch = /^[-*]\s+(.*)$/.exec(nextTrimmed);
            if (subMatch?.[1]) subItems.push(subMatch[1]);
            i++;
          } else {
            break;
          }
        }
        items.push({
          text: cleanText,
          ...(checked !== undefined ? { checked } : {}),
          ...(subItems.length > 0 ? { subItems } : {}),
        });
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    // Plain blockquotes (non-callout). Callouts (`> [!NOTE]`) are handled above.
    if (trimmed.startsWith('>') && !trimmed.startsWith('> [!')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // Paragraph
    blocks.push({ type: 'paragraph', text: trimmed });
    i++;
  }

  return blocks;
}

function HeadingElement({
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

/**
 * Line Comment Row Container with Hover Icon & Inline Popover (Matching Antigravity Reference)
 */
function LineCommentWrapper({
  as = 'div',
  lineId,
  lineText,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
  children,
  className = '',
}: {
  as?: 'div' | 'li' | undefined;
  lineId: string;
  lineText?: string | null | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
  children: ReactNode;
  className?: string | undefined;
}): ReactElement {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverMode, setPopoverMode] = useState<'create' | 'view' | 'edit'>('create');
  const [inputText, setInputText] = useState('');
  const [editText, setEditText] = useState('');

  const validText = typeof lineText === 'string' ? lineText.trim() : '';
  const existingComment = comments.find((c) => c.lineId === lineId);
  const hasComment = Boolean(existingComment);

  function handleTogglePopover(): void {
    if (popoverOpen) {
      setPopoverOpen(false);
      return;
    }
    if (hasComment) {
      setPopoverMode('view');
    } else {
      setPopoverMode('create');
      setInputText('');
    }
    setPopoverOpen(true);
  }

  function handleCreateSubmit(): void {
    const textToSave = inputText.trim();
    if (!textToSave || !validText) return;

    onAddComment?.({
      lineId,
      lineText: validText,
      commentText: textToSave,
    });
    onCommentLine?.(`[${validText}] "${textToSave}"`);
    setPopoverOpen(false);
    setInputText('');
  }

  function handleEditSubmit(): void {
    const textToSave = editText.trim();
    if (!textToSave || !existingComment) return;

    onEditComment?.(existingComment.id, textToSave);
    setPopoverMode('view');
  }

  function handleDelete(): void {
    if (!existingComment) return;
    onDeleteComment?.(existingComment.id);
    setPopoverOpen(false);
  }

  const WrapperTag = as;

  return (
    <WrapperTag
      className={[
        'enhanced-line-wrapper',
        'has-hover-highlight',
        hasComment ? 'has-comment' : '',
        popoverOpen ? 'popover-open' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="line-main-content">{children}</div>

      <button
        type="button"
        className={`line-comment-btn ${hasComment ? 'has-comment' : ''}`}
        title={hasComment ? 'View comment' : 'Add comment'}
        aria-label={hasComment ? 'View comment' : 'Add comment'}
        onClick={(e) => {
          e.stopPropagation();
          handleTogglePopover();
        }}
      >
        <IconCommentAction width={14} height={14} />
      </button>

      {popoverOpen ? (
        <div className="line-comment-popover-anchor">
          <div className="line-comment-popover">
            {popoverMode === 'create' ? (
              <>
                <textarea
                  className="line-comment-input"
                  placeholder="Leave a comment"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  autoFocus
                />
                <div className="line-comment-popover-actions">
                  <button
                    type="button"
                    className="popover-btn-cancel"
                    onClick={() => setPopoverOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="popover-btn-submit"
                    disabled={!inputText.trim()}
                    onClick={handleCreateSubmit}
                  >
                    Add Comment
                  </button>
                </div>
              </>
            ) : popoverMode === 'edit' ? (
              <>
                <textarea
                  className="line-comment-input"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                />
                <div className="line-comment-popover-actions">
                  <button
                    type="button"
                    className="popover-btn-cancel"
                    onClick={() => setPopoverMode('view')}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="popover-btn-submit"
                    disabled={!editText.trim()}
                    onClick={handleEditSubmit}
                  >
                    Save
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="line-comment-body">{existingComment?.commentText}</div>
                <div className="line-comment-popover-actions">
                  <button type="button" className="popover-btn-delete" onClick={handleDelete}>
                    Delete
                  </button>
                  <button
                    type="button"
                    className="popover-btn-edit"
                    onClick={() => {
                      setEditText(existingComment?.commentText || '');
                      setPopoverMode('edit');
                    }}
                  >
                    Edit Comment
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </WrapperTag>
  );
}

function CodeBlockView({
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
  const isDiff =
    language.toLowerCase() === 'diff' ||
    lines.some((l) => l.startsWith('+ ') || l.startsWith('- '));
  const FOLD_THRESHOLD = 16;
  const isLong = lines.length > FOLD_THRESHOLD;
  const visibleLines = isLong && !expanded ? lines.slice(0, FOLD_THRESHOLD) : lines;
  const visibleSource = useMemo(() => visibleLines.join('\n'), [visibleLines]);
  const highlightLang = isDiff ? 'diff' : normalizeLanguage(language);
  const tokenLines = useHighlight(visibleSource, highlightLang);

  return (
    <div className={`enhanced-code-block${isLong && !expanded ? ' folded' : ''}`}>
      <div className="enhanced-code-header">
        <span className="code-lang">{language || (isDiff ? 'diff' : 'code')}</span>
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

function EnhancedBlockView({
  blockIndex,
  block,
  docTitle,
  filePath,
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
  onOpenFile?: ((filePath: string) => void) | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
}): ReactElement {
  const blockLineId = `block-${blockIndex}-${block.type}`;

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
            <span>{renderFormattedText(scopeMatch[1], onOpenFile)}</span>
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
          {renderFormattedText(block.text, onOpenFile)}
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
      const katexResult = renderKatex(block.source, true);
      if (katexResult.ok) {
        return (
          <div
            className="enhanced-math-display"
            dangerouslySetInnerHTML={{ __html: katexResult.html }}
          />
        );
      }
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
        <div className="callout-content">{renderFormattedText(block.text, onOpenFile)}</div>
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
                <span>{renderFormattedText(item.text, onOpenFile)}</span>
              </div>
              {item.subItems && item.subItems.length > 0 ? (
                <ul className="enhanced-sub-list">
                  {item.subItems.map((sub, subIndex) => (
                    <li key={subIndex} className="enhanced-sub-item">
                      <span>{renderFormattedText(sub, onOpenFile)}</span>
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
        <blockquote>{renderFormattedText(block.text, onOpenFile)}</blockquote>
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
                  {renderFormattedText(header, onOpenFile)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} style={{ textAlign: getTextAlign(block.alignments[cIdx]) }}>
                    {renderFormattedText(cell, onOpenFile)}
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
      <p className="enhanced-paragraph">{renderFormattedText(block.text, onOpenFile)}</p>
    </LineCommentWrapper>
  );
}

function DiffBadge({ action }: { action: DiffActionType }): ReactElement {
  const toneClass =
    action === 'MODIFY'
      ? 'badge-modify'
      : action === 'NEW'
        ? 'badge-new'
        : action === 'DELETE'
          ? 'badge-delete'
          : 'badge-rename';

  return <span className={`diff-action-badge ${toneClass}`}>[{action}]</span>;
}

function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="compact"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* ignore */
          }
        })();
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * Format inline text with inline code (`code`), strong (**text**), math ($...$), and links ([title](url)).
 */
function renderFormattedText(
  text: string,
  onOpenFile?: ((filePath: string) => void) | undefined,
): Array<string | ReactElement> {
  const parts: Array<string | ReactElement> = [];
  let key = 0;

  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\$[^$\n]+\$|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      const codeContent = matchedStr.slice(1, -1);
      const isPath =
        /(?:^|\/|[A-Za-z]:[\\/])[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.[a-zA-Z0-9]+$/i.test(codeContent) ||
        /^\/(?:[a-zA-Z0-9_\u4e00-\u9fa5.-]+\/)+$/i.test(codeContent) ||
        /^[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.(?:ts|tsx|js|jsx|py|json|css|scss|md|html|rs|go|sh|png|jpg|svg)$/i.test(
          codeContent,
        );

      if (isPath) {
        parts.push(
          <PathChip
            key={key++}
            fullPath={codeContent}
            showIcon={true}
            onOpen={() => onOpenFile?.(codeContent)}
          />,
        );
      } else {
        parts.push(
          <code key={key++} className="enhanced-inline-code">
            {codeContent}
          </code>,
        );
      }
    } else if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
      parts.push(
        <strong key={key++} className="enhanced-strong">
          {matchedStr.slice(2, -2)}
        </strong>,
      );
    } else if (matchedStr.startsWith('*') && matchedStr.endsWith('*')) {
      parts.push(<em key={key++}>{matchedStr.slice(1, -1)}</em>);
    } else if (matchedStr.startsWith('$') && matchedStr.endsWith('$')) {
      const tex = matchedStr.slice(1, -1);
      const katexRes = renderKatex(tex, false);
      if (katexRes.ok) {
        parts.push(
          <span
            key={key++}
            className="enhanced-math-inline"
            dangerouslySetInnerHTML={{ __html: katexRes.html }}
          />,
        );
      } else {
        parts.push(matchedStr);
      }
    } else if (matchedStr.startsWith('[') && matchedStr.includes('](')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(matchedStr);
      if (linkMatch && linkMatch[1] && linkMatch[2]) {
        parts.push(
          <a
            key={key++}
            href={linkMatch[2]}
            className="enhanced-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        parts.push(matchedStr);
      }
    } else {
      parts.push(matchedStr);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
