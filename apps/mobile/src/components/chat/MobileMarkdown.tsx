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
  math: createMathPlugin({ singleDollarTextMath: true }),
};

export const MobileMarkdown = memo(function MobileMarkdown({
  content,
  isStreaming = false,
}: MobileMarkdownProps): ReactElement {
  const components: Components = useMemo(
    () => ({
      code({ className, children, ...rest }: ComponentProps<'code'>) {
        const match = /language-(\w+)/.exec(className || '');
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error on older mobile webviews
    }
  };

  return (
    <div className="mobile-code-block-card">
      <div className="mobile-code-block-header">
        <div className="mobile-code-window-dots">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
          <span className="mobile-code-block-lang">{language || 'code'}</span>
        </div>
        <button
          type="button"
          className="mobile-code-copy-button"
          onClick={() => void handleCopy()}
          aria-label="复制代码"
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <pre className="mobile-code-pre">{children}</pre>
    </div>
  );
}
