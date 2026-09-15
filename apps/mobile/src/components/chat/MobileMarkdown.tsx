import { memo, useMemo, useState, type ComponentProps, type ReactElement } from 'react';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';
import { Streamdown, type Components } from 'streamdown';

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

        return (
          <MobileCodeBlock language={language ?? ''} codeText={codeText}>
            <code className={className} {...rest}>
              {children}
            </code>
          </MobileCodeBlock>
        );
      },
      table({ children, ...rest }: ComponentProps<'table'>) {
        return (
          <div className="mobile-table-wrapper">
            <table {...rest}>{children}</table>
          </div>
        );
      },
    }),
    [],
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
  children,
}: {
  language: string;
  codeText: string;
  children: React.ReactNode;
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
        <div
          className="mobile-svg-preview-stage"
          dangerouslySetInnerHTML={{ __html: codeText }}
        />
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
      <pre className="mobile-code-pre">{children}</pre>
    </div>
  );
}
