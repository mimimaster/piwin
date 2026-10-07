import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cjk } from '@streamdown/cjk';
import { Streamdown, type Components, type ExtraProps } from 'streamdown';
import { PathChip } from './path-chip';
import { MermaidBlock } from './MermaidBlock';
import { escapeRawHtmlInMarkdown } from './markdown-html-escape';
import { isMermaidFenceLanguage, isMathFenceLanguage } from './markdown-math';
import { MathView } from './markdown-math-view.js';
import { commentsRenderKey } from './doc-comments';
import { LineCommentWrapper } from './enhanced-markdown-comments';
import { HeadingElement } from './enhanced-markdown-legacy';
import { CodeBlockView } from './enhanced-markdown-code-block';
import type { EnhancedMarkdownViewProps, LineCommentItem } from './enhanced-markdown-types.js';
import {
  getStreamdownMathPlugin,
  loadStreamdownMathPlugin,
  type StreamdownMathPlugin,
} from './streamdown-math-plugin.js';

const ENHANCED_STREAMDOWN_BASE_PLUGINS = { cjk } as const;
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

function flattenReactNodes(value: ReactNode): ReactNode[] {
  return Children.toArray(value);
}

function classNameTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).filter(Boolean);
}

function hastTagName(node: ReactNode): string | undefined {
  if (!isValidElement(node)) return undefined;
  const tagName = (node.props as { node?: { tagName?: unknown } }).node?.tagName;
  return typeof tagName === 'string' ? tagName : undefined;
}

function isEnhancedListElement(node: ReactNode): boolean {
  const tagName = hastTagName(node);
  if (tagName === 'ul' || tagName === 'ol') return true;
  if (!isValidElement(node)) return false;
  if (node.type === 'ul' || node.type === 'ol') return true;
  return classNameTokens((node.props as { className?: unknown }).className).includes('enhanced-list');
}

function isSelfWrappingMarkdownBlock(node: ReactNode): boolean {
  const tagName = hastTagName(node);
  return tagName === 'p' || tagName === 'blockquote' || tagName === 'pre' || Boolean(tagName && /^h[1-6]$/.test(tagName));
}

function isEnhancedLineWrapperElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { className?: unknown; lineId?: unknown };
  if (typeof props.lineId === 'string') return true;
  return classNameTokens(props.className).includes('enhanced-line-wrapper');
}

function isWhitespaceNode(node: ReactNode): boolean {
  return typeof node === 'string' && node.trim() === '';
}

function splitEnhancedListItemChildren(children: ReactNode): {
  own: ReactNode[];
  nested: ReactNode[];
} {
  const own: ReactNode[] = [];
  const nested: ReactNode[] = [];
  for (const node of flattenReactNodes(children)) {
    if (isEnhancedListElement(node)) nested.push(node);
    else own.push(node);
  }
  return { own, nested };
}

function listItemOwnContentIsWrapped(own: ReactNode[]): boolean {
  const meaningful = own.filter((node) => !isWhitespaceNode(node));
  return (
    meaningful.length > 0 &&
    meaningful.every((node) => isEnhancedLineWrapperElement(node) || isSelfWrappingMarkdownBlock(node))
  );
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

export function EnhancedStreamdownContent({
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
}: EnhancedStreamdownContentProps): ReactElement {
  const escapedText = useMemo(() => escapeRawHtmlInMarkdown(text), [text]);
  const components = useMemo(
    () =>
      createEnhancedStreamdownComponents({
        docTitle,
        filePath,
        projectPath,
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
      projectPath,
      onOpenFile,
      comments,
      onAddComment,
      onEditComment,
      onDeleteComment,
      onCommentLine,
    ],
  );
  const [mathPlugin, setMathPlugin] = useState<StreamdownMathPlugin | null>(() =>
    getStreamdownMathPlugin(),
  );
  useEffect(() => {
    if (mathPlugin) return undefined;
    let cancelled = false;
    void loadStreamdownMathPlugin().then((plugin) => {
      if (!cancelled) setMathPlugin(plugin);
    });
    return () => {
      cancelled = true;
    };
  }, [mathPlugin]);
  const plugins = useMemo(
    () => (mathPlugin ? { cjk, math: mathPlugin } : ENHANCED_STREAMDOWN_BASE_PLUGINS),
    [mathPlugin],
  );

  return (
    <Streamdown
      key={commentsRenderKey(comments)}
      className="enhanced-markdown-streamdown"
      mode="static"
      parseIncompleteMarkdown={false}
      plugins={plugins}
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
  projectPath: string | undefined;
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
    const { own, nested } = splitEnhancedListItemChildren(children);
    const meaningfulOwn = own.filter((child) => !isWhitespaceNode(child));
    const lineText = enhancedPlainText(own);
    const ownRow =
      meaningfulOwn.length === 0 ? null : listItemOwnContentIsWrapped(own) ? (
        <div className="item-text">{own}</div>
      ) : (
        wrapReviewLine('list', node, lineText, <div className="item-text">{own}</div>)
      );
    return (
      <li className="enhanced-list-item">
        {ownRow}
        {nested}
      </li>
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
            showIcon={true}
            {...(options.projectPath ? { projectPath: options.projectPath } : {})}
            onOpen={() => options.onOpenFile?.(source.trim())}
          />
        );
      }
      return <code className="enhanced-inline-code">{children}</code>;
    }

    // Whole info word: a ```12:40:src/a.ts reference must not be cut to "12".
    const languageMatch = /(?:^|\s)language-(\S+)/.exec(className ?? '');
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
      return wrapReviewLine(
        'code',
        node,
        lineText,
        <MathView tex={source} display className="enhanced-math-display" />,
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
          showIcon={true}
          {...(options.projectPath ? { projectPath: options.projectPath } : {})}
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
