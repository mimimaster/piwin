/**
 * Plain-code preview renderer for DocPreviewPanel.
 *
 * Used when the active document is not Markdown — renders the file with tight
 * monospace rows, line numbers, and Shiki syntax highlighting (same highlighter
 * singleton used by diff-view and EnhancedMarkdownView).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useHighlight, languageFromPath, TokenSpans } from './syntax-highlight';
import {
  ContextMenuFromCatalog,
  type ContextMenuCapabilities,
  type ContextMenuDispatchers,
  type ContextMenuTarget,
} from './context-menu';

export type CodePreviewViewProps = {
  code: string;
  filePath: string;
  /** Optional CM wiring — enables right-click selection actions (CM-07). */
  contextMenuCaps?: ContextMenuCapabilities | undefined;
  contextMenuDispatchers?: ContextMenuDispatchers | undefined;
};

const MAX_SELECTION_CHARS = 8000;

/** Compute a `selection` context-menu target from the live window selection. */
function computeSelectionTarget(
  preElement: HTMLPreElement,
  filePath: string,
): ContextMenuTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!preElement.contains(range.commonAncestorContainer)) {
    return null;
  }
  const selectedText = selection.toString().slice(0, MAX_SELECTION_CHARS);
  if (!selectedText.trim()) {
    return null;
  }

  const rows = Array.from(preElement.querySelectorAll<HTMLElement>('.code-preview-row'));
  let lineStart: number | null = null;
  let lineEnd: number | null = null;
  rows.forEach((row, index) => {
    if (row.contains(range.startContainer)) lineStart = index + 1;
    if (row.contains(range.endContainer)) lineEnd = index + 1;
  });
  if (lineStart === null) {
    return null;
  }

  return {
    surface: 'selection',
    relativePath: filePath,
    lineStart,
    lineEnd: lineEnd ?? lineStart,
    selectedText,
    label: filePath,
  };
}

export function CodePreviewView({
  code,
  filePath,
  contextMenuCaps,
  contextMenuDispatchers,
}: CodePreviewViewProps): ReactElement {
  const lang = languageFromPath(filePath);
  const tokens = useHighlight(code, lang);
  const lines = code.split('\n');
  // Width of the line-number gutter in characters (min 2, so single-digit
  // lines don't jitter the column as the file grows).
  const gutterWidth = Math.max(2, String(lines.length).length);
  const preRef = useRef<HTMLPreElement | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<ContextMenuTarget | null>(null);

  const menuEnabled = Boolean(contextMenuCaps && contextMenuDispatchers);

  useEffect(() => {
    if (!menuEnabled) {
      setSelectionTarget(null);
      return;
    }
    const updateSelection = (): void => {
      if (!preRef.current) {
        setSelectionTarget(null);
        return;
      }
      setSelectionTarget(computeSelectionTarget(preRef.current, filePath));
    };
    document.addEventListener('selectionchange', updateSelection);
    window.addEventListener('mouseup', updateSelection);
    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      window.removeEventListener('mouseup', updateSelection);
    };
  }, [filePath, menuEnabled]);

  const pre = (
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

  if (menuEnabled && selectionTarget && contextMenuCaps && contextMenuDispatchers) {
    return (
      <ContextMenuFromCatalog
        testId="code-preview-context-menu"
        target={selectionTarget}
        caps={contextMenuCaps}
        dispatchers={contextMenuDispatchers}
      >
        {pre}
      </ContextMenuFromCatalog>
    );
  }
  return pre;
}
