import { memo, useMemo, useState, type ComponentProps, type ReactElement } from 'react';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';
import { Streamdown, type Components } from 'streamdown';
import { CodeView } from '../../inkstone/syntax/CodeView.js';
import { fenceLanguage } from '../../inkstone/syntax/file-kind.js';

type MobileMarkdownProps = {
  content: string;
  isStreaming?: boolean | undefined;
};

const STREAMDOWN_PLUGINS = {
  cjk,
  math: createMathPlugin({ singleDollarTextMath: false }),
};

export const MobileMarkdown = memo(function MobileMarkdown({
  content,
  isStreaming = false,
}: MobileMarkdownProps): ReactElement {
  const components: Components = useMemo(
    () => ({
      strong({ children, className, ...rest }: ComponentProps<'strong'>) {
        return (
          <strong
            {...rest}
            className={
              className ? `mobile-markdown-strong ${className}` : 'mobile-markdown-strong'
            }
          >
            {children}
          </strong>
        );
      },
      em({ children, className, ...rest }: ComponentProps<'em'>) {
        return (
          <em
            {...rest}
            className={className ? `mobile-markdown-em ${className}` : 'mobile-markdown-em'}
          >
            {children}
          </em>
        );
      },
      code({ className, children, ...rest }: ComponentProps<'code'>) {
        const match = /language-([\w-]+)/.exec(className || '');
        const isInline = !match && typeof children === 'string' && !children.includes('\n');

        if (isInline) {
          return (
            <code className="mobile-inline-code" {...rest}>
              {children}
            </code>
          );
        }

        const language = match ? match[1] : '';
        const codeText = String(children).replace(/\n$/, '');

        return <MobileCodeBlock language={language ?? ''} codeText={codeText} settled={!isStreaming} />;
      },
      table({ children, ...rest }: ComponentProps<'table'>) {
        return (
          <div className="mobile-table-wrapper">
            <table {...rest}>{children}</table>
          </div>
        );
      },
    }),
    [isStreaming],
  );

  return (
    <div className={`mobile-markdown-root ${isStreaming ? 'streaming' : ''}`}>
      <Streamdown
        plugins={STREAMDOWN_PLUGINS}
        components={components}
        parseIncompleteMarkdown={isStreaming}
      >
        {content}
      </Streamdown>
      {isStreaming ? <span className="modern-streaming-cursor inline" /> : null}
    </div>
  );
});

function MobileCodeBlock({
  language,
  codeText,
  settled,
}: {
  language: string;
  codeText: string;
  /** Highlight only once the fence stops streaming; tokenizing every delta is wasted work. */
  settled: boolean;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const langLower = (language || '').toLowerCase();
  const trimmed = codeText.trim();
  const isSvg =
    (langLower === 'svg' || langLower === 'xml' || langLower === 'html' || langLower === '') &&
    trimmed.includes('<svg') &&
    trimmed.includes('</svg>');
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>(isSvg ? 'preview' : 'code');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error on older mobile webviews
    }
  };

  if (isSvg && activeTab === 'preview') {
    return (
      <div className="mobile-artifact-inline-preview" data-testid="mobile-artifact-inline-preview">
        {/* Model output is untrusted: an <img> renders SVG without ever
            running its scripts or event handlers in the app origin. */}
        <div className="mobile-svg-preview-stage">
          <img src={svgDataUri(codeText)} alt="SVG 预览" />
        </div>
        <div className="mobile-artifact-floating-actions">
          <button
            type="button"
            className="mobile-artifact-action-btn"
            onClick={() => setActiveTab('code')}
            aria-label="查看代码"
          >
            代码
          </button>
          <button
            type="button"
            className="mobile-artifact-action-btn"
            onClick={() => void handleCopy()}
            aria-label="复制代码"
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-code-block-card">
      <div className="mobile-code-block-header">
        <span className="mobile-code-block-lang">{language || 'code'}</span>
        <div className="mobile-code-block-actions">
          {isSvg ? (
            <button
              type="button"
              className="mobile-code-copy-button"
              onClick={() => setActiveTab('preview')}
            >
              预览
            </button>
          ) : null}
          <button
            type="button"
            className="mobile-code-copy-button"
            onClick={() => void handleCopy()}
            aria-label="复制代码"
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>
      </div>
      <CodeView code={codeText} language={fenceLanguage(language)} highlight={settled} lineNumbers={false} />
    </div>
  );
}

function svgDataUri(source: string): string {
  const start = source.indexOf('<svg');
  const svg = start >= 0 ? source.slice(start) : source;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
