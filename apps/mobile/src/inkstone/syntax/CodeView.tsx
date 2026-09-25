import { memo, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { highlightCode, type HighlightedLine } from './highlighter.js';

/**
 * Read-only code with line numbers. Paints plain text immediately, then swaps
 * in Shiki tokens; both paper and ink colours ride on each token as CSS
 * variables so switching face never re-tokenizes. `highlight={false}` keeps
 * streaming fences plain until they settle.
 */
export const CodeView = memo(function CodeView({
  code,
  language,
  highlight = true,
  lineNumbers = true,
}: {
  code: string;
  language: string | undefined;
  highlight?: boolean;
  lineNumbers?: boolean;
}): ReactElement {
  const [tokens, setTokens] = useState<{ key: string; lines: HighlightedLine[] } | undefined>();
  const key = `${language ?? ''}\u0000${code}`;

  useEffect(() => {
    if (!highlight || language === undefined) return;
    let cancelled = false;
    highlightCode(code, language)
      .then((lines) => {
        if (!cancelled && lines !== undefined) setTokens({ key, lines });
      })
      .catch((error: unknown) => console.warn('[highlight] failed', error));
    return () => {
      cancelled = true;
    };
  }, [code, language, highlight, key]);

  const highlighted = tokens?.key === key ? tokens.lines : undefined;
  const plain = highlighted === undefined ? code.split('\n') : undefined;
  const rows = highlighted?.length ?? plain?.length ?? 0;

  return (
    <pre className={`code-view ${lineNumbers ? 'numbered' : ''}`.trim()} data-language={language}>
      <code>
        {Array.from({ length: rows }, (_, index) => (
          <span className="code-line" key={index}>
            {lineNumbers ? <span className="ln">{index + 1}</span> : null}
            <span className="lc">
              {highlighted !== undefined
                ? highlighted[index]?.map((token, tokenIndex) => (
                    <span
                      key={tokenIndex}
                      style={{ '--tl': token.light, '--td': token.dark } as CSSProperties}
                    >
                      {token.content}
                    </span>
                  ))
                : plain?.[index]}
              {'\n'}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
});
