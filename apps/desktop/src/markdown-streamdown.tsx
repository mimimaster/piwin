import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type JSX,
  type ReactElement,
} from 'react';
import {
  STREAMING_ARTIFACT_FENCE_MARKER,
  type ArtifactActionMessage,
  type ArtifactFenceRecord,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { type Components, type ExtraProps } from 'streamdown';
import { fileNameFromPath, PathChip } from './path-chip.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import { lookupIndexedFence } from './markdown-artifact-fence-lookup.js';
import {
  MarkdownCodeFence,
  type MarkdownCodeFenceProps,
  type MarkdownRenderingPhase,
} from './markdown-code-fence.js';
import { isLocalFilesystemMarkdownMediaSrc } from './media-path.js';
import {
  isLocalDirectoryPath,
  isLocalFileMarkdownHref,
  isLocalPathChipCandidate,
} from './markdown-local-links.js';
import {
  mergeMarkdownClassNames,
  plainTextFromReactNode,
  renderMarkdownChildren,
  stripLeadingCalloutMarker,
  type MarkdownDocumentReference,
} from './markdown-streamdown-nodes.js';
import { createMarkdownInlineRenderers } from './markdown-inline-renderers.js';

export type StreamdownRendererOptions = {
  phase: MarkdownRenderingPhase;
  htmlUiModeEnabled: boolean;
  artifactTheme: ArtifactThemeVariables | undefined;
  initPriorityBase: number;
  artifactThemeKey: string;
  onArtifactAction: ((action: ArtifactActionMessage) => void) | undefined;
  artifactOrigin: { sessionId: string; messageId: string } | undefined;
  onOpenArtifactCanvas: ((target: ArtifactCanvasTarget) => void) | undefined;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst: boolean;
  artifactMaxBytes: number | undefined;
  artifactBlockExternalScripts: boolean | undefined;
  artifactBlockExternalResources: boolean | undefined;
  locale: 'zh-CN' | 'en';
  onOpenDocument: ((doc: MarkdownDocumentReference) => void) | undefined;
  projectPath: string | null | undefined;
  /** Canonical fence ordinal keyed by Streamdown `node.position.start.offset`. */
  ordinalByProjectedStartOffset: ReadonlyMap<number, number>;
  fences: readonly ArtifactFenceRecord[];
};



function streamingFenceInfo(record: ArtifactFenceRecord, streaming: boolean): string {
  if (!streaming || !record.open) {
    return record.info;
  }
  const alias = record.language.toLowerCase();
  if (alias !== 'html' && alias !== 'htm' && alias !== 'svg') {
    return record.info;
  }
  if (record.info.includes(STREAMING_ARTIFACT_FENCE_MARKER)) {
    return record.info;
  }
  return `${record.info} ${STREAMING_ARTIFACT_FENCE_MARKER}`;
}

type StreamdownElementProps<Tag extends keyof JSX.IntrinsicElements> = ComponentProps<Tag> &
  ExtraProps;

type StreamdownCodeProps = StreamdownElementProps<'code'> & {
  'data-block'?: boolean | string;
};

export function createStreamdownComponents(optionsRef: {
  current: StreamdownRendererOptions;
}): Components {
  const renderParagraph = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'p'>): ReactElement => (
    <p {...props} className={mergeMarkdownClassNames('md-p', className)}>
      {renderMarkdownChildren(
        children,
        optionsRef.current.onOpenDocument,
        optionsRef.current.projectPath,
      )}
    </p>
  );

  const renderHeading =
    (level: number) =>
    ({
      children,
      node: _node,
      className,
      ...props
    }: StreamdownElementProps<'h1'>): ReactElement => {
      const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <HeadingTag {...props} className={mergeMarkdownClassNames(`md-h md-h${level}`, className)}>
          {renderMarkdownChildren(
            children,
            optionsRef.current.onOpenDocument,
            optionsRef.current.projectPath,
          )}
        </HeadingTag>
      );
    };

  const renderList = (
    { children, node: _node, className }: StreamdownElementProps<'ul'>,
    ordered: boolean,
  ): ReactElement => {
    const ListTag = ordered ? 'ol' : 'ul';
    return (
      <ListTag
        className={mergeMarkdownClassNames(
          ordered ? 'md-list md-list-ordered' : 'md-list',
          className,
        )}
      >
        {children}
      </ListTag>
    );
  };

  const renderCode = ({
    children,
    className,
    node,
    'data-block': dataBlock,
    ...props
  }: StreamdownCodeProps): ReactElement => {
    const options = optionsRef.current;
    if (dataBlock === undefined) {
      const inlineValue = plainTextFromReactNode(children).trim();
      if (isLocalPathChipCandidate(inlineValue) && options.onOpenDocument) {
        return (
          <PathChip
            fullPath={inlineValue}
            {...(options.projectPath ? { projectPath: options.projectPath } : {})}
            onOpen={() =>
              options.onOpenDocument?.({
                title: fileNameFromPath(inlineValue),
                path: inlineValue,
              })
            }
          />
        );
      }
      return (
        <code {...props} className={mergeMarkdownClassNames('md-inline-code', className)}>
          {children}
        </code>
      );
    }

    const startOffset = node?.position?.start?.offset;
    const languageMatch = /(?:^|\s)language-([A-Za-z0-9_-]+)/.exec(className ?? '');
    const fallbackLanguage = languageMatch?.[1] ?? '';
    const record = lookupIndexedFence({
      fences: options.fences,
      ordinalByProjectedStartOffset: options.ordinalByProjectedStartOffset,
      startOffset,
      language: fallbackLanguage,
    });
    const originKey = options.artifactOrigin?.messageId ?? 'local';
    const fenceProps: MarkdownCodeFenceProps = {
      language: record?.language ?? fallbackLanguage,
      fenceInfo: record
        ? streamingFenceInfo(record, options.phase === 'streaming')
        : fallbackLanguage,
      source: record?.source ?? plainTextFromReactNode(children).replace(/\n$/, ''),
      htmlUiModeEnabled: options.htmlUiModeEnabled,
      fenceIndex: record?.ordinal ?? null,
      renderingPhase: options.phase,
      initPriority:
        record === null ? options.initPriorityBase : options.initPriorityBase + record.ordinal,
      artifactThemeKey: options.artifactThemeKey,
      artifactPreviewEnabled: options.artifactPreviewEnabled,
      artifactCodeFirst: options.artifactCodeFirst,
      locale: options.locale,
    };
    if (options.artifactTheme) fenceProps.artifactTheme = options.artifactTheme;
    if (options.onArtifactAction) fenceProps.onArtifactAction = options.onArtifactAction;
    if (options.artifactOrigin) fenceProps.artifactOrigin = options.artifactOrigin;
    if (options.onOpenArtifactCanvas) {
      fenceProps.onOpenArtifactCanvas = options.onOpenArtifactCanvas;
    }
    if (options.artifactMaxBytes !== undefined) {
      fenceProps.artifactMaxBytes = options.artifactMaxBytes;
    }
    if (options.artifactBlockExternalScripts !== undefined) {
      fenceProps.artifactBlockExternalScripts = options.artifactBlockExternalScripts;
    }
    if (options.artifactBlockExternalResources !== undefined) {
      fenceProps.artifactBlockExternalResources = options.artifactBlockExternalResources;
    }
    // Stable React key (owi __displayKey): never include source body.
    const fenceKey =
      record === null
        ? `${originKey}:code-unbound:${typeof startOffset === 'number' ? String(startOffset) : 'none'}`
        : `${originKey}:artifact-${record.ordinal}`;
    return <MarkdownCodeFence key={fenceKey} {...fenceProps} />;
  };

  const renderAnchor = ({
    children,
    href,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'a'>): ReactElement => {
    const options = optionsRef.current;
    const url = href ?? '';
    const label = plainTextFromReactNode(children).trim() || 'Document';
    const normalizedUrl = url.split('#', 1)[0]?.split('?', 1)[0]?.toLowerCase() ?? '';
    const isDocumentLink =
      normalizedUrl.endsWith('.md') ||
      label.includes('Plan') ||
      label.includes('Document') ||
      label.startsWith('📄');
    const isLocalPathLink = isLocalFileMarkdownHref(url);

    if (isLocalDirectoryPath(url)) {
      return (
        <code className={mergeMarkdownClassNames('md-inline-code', className)}>{children}</code>
      );
    }

    if ((isDocumentLink || isLocalPathLink) && options.onOpenDocument) {
      return (
        <PathChip
          fullPath={url}
          label={label}
          {...(options.projectPath ? { projectPath: options.projectPath } : {})}
          onOpen={() => options.onOpenDocument?.({ title: label, path: url })}
        />
      );
    }

    return (
      <a
        {...props}
        {...(href ? { href } : {})}
        className={mergeMarkdownClassNames('md-link', className)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  };

  const renderTable = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'table'>): ReactElement => (
    <div className="md-table-wrapper" data-testid="md-table">
      <table {...props} className={mergeMarkdownClassNames('md-table', className)}>
        {children}
      </table>
    </div>
  );

  const renderTableCell = ({
    children,
    node: _node,
    align,
    style,
    ...props
  }: StreamdownElementProps<'th'>): ReactElement => {
    const textAlign =
      align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    return (
      <th {...props} style={textAlign ? { ...style, textAlign } : style}>
        {renderMarkdownChildren(children, optionsRef.current.onOpenDocument)}
      </th>
    );
  };

  const renderTableDataCell = ({
    children,
    node: _node,
    align,
    style,
    ...props
  }: StreamdownElementProps<'td'>): ReactElement => {
    const textAlign =
      align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    return (
      <td {...props} style={textAlign ? { ...style, textAlign } : style}>
        {renderMarkdownChildren(children, optionsRef.current.onOpenDocument)}
      </td>
    );
  };

  const renderBlockquote = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'blockquote'>): ReactElement =>
    (() => {
      const calloutMatch = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
        plainTextFromReactNode(children),
      );
      if (calloutMatch?.[1]) {
        const kind = calloutMatch[1].toLowerCase();
        return (
          <div
            className={mergeMarkdownClassNames(`md-callout md-callout-${kind}`, className)}
            data-testid={`callout-${kind}`}
          >
            <div className="md-callout-header">
              <span className="md-callout-badge">{kind.toUpperCase()}</span>
            </div>
            <div className="md-callout-body">{stripLeadingCalloutMarker(children)}</div>
          </div>
        );
      }
      return (
        <blockquote {...props} className={mergeMarkdownClassNames('md-blockquote', className)}>
          {children}
        </blockquote>
      );
    })();

  const renderImage = ({
    node: _node,
    alt,
    src,
    ...props
  }: StreamdownElementProps<'img'>): ReactElement => {
    if (!src) return <span className="md-image-fallback">{alt || 'Image unavailable'}</span>;
    if (isLocalFilesystemMarkdownMediaSrc(src)) {
      return <></>;
    }
    return <img {...props} src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />;
  };

  const renderInput = ({
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'input'>): ReactElement => (
    <input
      {...props}
      type={props.type ?? 'checkbox'}
      disabled
      className={mergeMarkdownClassNames('md-task-checkbox', className)}
    />
  );

  const renderSection = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'section'> & {
    'data-footnotes'?: string | boolean;
  }): ReactElement => {
    const isFootnotes =
      (typeof className === 'string' && className.includes('footnotes')) ||
      props['data-footnotes'] !== undefined;
    return (
      <section
        {...props}
        className={mergeMarkdownClassNames(isFootnotes ? 'md-footnotes' : '', className)}
      >
        {children}
      </section>
    );
  };

  return {
    ...createMarkdownInlineRenderers(),
    p: renderParagraph,
    h1: renderHeading(1),
    h2: renderHeading(2),
    h3: renderHeading(3),
    h4: renderHeading(4),
    h5: renderHeading(5),
    h6: renderHeading(6),
    ul: (props) => renderList(props, false),
    ol: (props) => renderList(props, true),
    li: ({ children, node: _node, className, ...props }: StreamdownElementProps<'li'>) => (
      <li {...props} className={mergeMarkdownClassNames('md-list-item', className)}>
        {children}
      </li>
    ),
    blockquote: renderBlockquote,
    table: renderTable,
    th: renderTableCell,
    td: renderTableDataCell,
    code: renderCode,
    pre: ({ children, node: _node }: StreamdownElementProps<'pre'>) =>
      isValidElement<StreamdownCodeProps>(children) ? (
        cloneElement(children, { 'data-block': 'true' })
      ) : (
        <>{children}</>
      ),
    a: renderAnchor,
    img: renderImage,
    input: renderInput,
    section: renderSection,
    hr: ({ node: _node, className, ...props }: StreamdownElementProps<'hr'>) => (
      <hr {...props} className={mergeMarkdownClassNames('md-hr', className)} />
    ),
    del: ({ children, node: _node, className, ...props }: StreamdownElementProps<'del'>) => (
      <del {...props} className={mergeMarkdownClassNames('md-del', className)}>
        {children}
      </del>
    ),
  };
}
