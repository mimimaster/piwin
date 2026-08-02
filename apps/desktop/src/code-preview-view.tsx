/**
 * Plain-code preview renderer for DocPreviewPanel.
 *
 * Used when the active document is not Markdown — renders the file with tight
 * monospace rows, line numbers, and Shiki syntax highlighting (same highlighter
 * singleton used by diff-view and EnhancedMarkdownView).
 */
import { type ReactElement } from 'react';
import { useHighlight, languageFromPath, TokenSpans } from './syntax-highlight';

export type CodePreviewViewProps = {
  code: string;
  filePath: string;
};

export function CodePreviewView({ code, filePath }: CodePreviewViewProps): ReactElement {
  const lang = languageFromPath(filePath);
  const tokens = useHighlight(code, lang);
  const lines = code.split('\n');
  // Width of the line-number gutter in characters (min 2, so single-digit
  // lines don't jitter the column as the file grows).
  const gutterWidth = Math.max(2, String(lines.length).length);

  return (
    <pre className="code-preview-view" data-testid="code-preview-view">
      {lines.map((line, index) => {
        const lineTokens = tokens?.[index] ?? null;
        return (
          <div key={index} className="code-preview-row">
            <span className="code-preview-lineno" aria-hidden="true">
              {String(index + 1).padStart(gutterWidth, ' ')}
            </span>
            <span className="code-preview-text">
              {lineTokens ? <TokenSpans tokens={lineTokens} /> : line}
            </span>
          </div>
        );
      })}
    </pre>
  );
}
