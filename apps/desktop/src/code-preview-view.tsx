/**
 * Plain-code preview renderer for DocPreviewPanel.
 *
 * Used when the active document is not Markdown — renders the file with tight
 * monospace rows, line numbers, and Shiki syntax highlighting (same highlighter
 * singleton used by diff-view and EnhancedMarkdownView).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { languageFromPath } from './syntax-highlight.js';
import { useFileHighlight } from './syntax/file-highlight.js';
import { CodePreviewLines } from './code-preview-lines.js';
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
  /** Project root for the displayed file — upgrades selection refs to kind:'file'. */
  projectPath?: string | undefined;
};

const MAX_SELECTION_CHARS = 8000;

/** Compute a `selection` context-menu target from the live window selection. */
function computeSelectionTarget(
  preElement: HTMLPreElement,
  filePath: string,
  projectPath: string | undefined,
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

  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startEl = startContainer instanceof Element ? startContainer : startContainer.parentElement;
  const endEl = endContainer instanceof Element ? endContainer : endContainer.parentElement;
  const startRow = startEl?.closest<HTMLElement>('.code-preview-row');
  const endRow = endEl?.closest<HTMLElement>('.code-preview-row');

  const lineStart = startRow?.dataset.line ? Number(startRow.dataset.line) : null;
  const lineEnd = endRow?.dataset.line ? Number(endRow.dataset.line) : lineStart;
  if (lineStart === null) {
    return null;
  }

  return {
    surface: 'selection',
    ...(projectPath ? { projectPath } : {}),
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
  projectPath,
}: CodePreviewViewProps): ReactElement {
  const lang = languageFromPath(filePath);
  const tokens = useFileHighlight(code, lang);
  const lines = useMemo(() => code.split('\n'), [code]);
  // Width of the line-number gutter in characters (min 2, so single-digit
  // lines don't jitter the column as the file grows).
  const gutterWidth = Math.max(2, String(lines.length).length);
  const preRef = useRef<HTMLPreElement | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<ContextMenuTarget | null>(null);
  // Retains the last non-null selection so the context menu stays populated
  // when Radix clears the browser selection on menu open.
  const lastSelectionRef = useRef<ContextMenuTarget | null>(null);

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
      const next = computeSelectionTarget(preRef.current, filePath, projectPath);
      if (next) {
        lastSelectionRef.current = next;
      }
      setSelectionTarget(next);
    };
    document.addEventListener('selectionchange', updateSelection);
    window.addEventListener('mouseup', updateSelection);
    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      window.removeEventListener('mouseup', updateSelection);
    };
  }, [filePath, menuEnabled, projectPath]);

  const pre = (
    <pre className="code-preview-view" data-testid="code-preview-view" ref={preRef}>
      <CodePreviewLines lines={lines} tokens={tokens} gutterWidth={gutterWidth} preRef={preRef} />
    </pre>
  );

  // Use the live selection target when available; fall back to the last
  // selection so the context menu stays populated when Radix clears the
  // browser selection on menu open (selectionchange → null).
  const effectiveTarget = selectionTarget ?? lastSelectionRef.current;

  if (menuEnabled && contextMenuCaps && contextMenuDispatchers) {
    return (
      <ContextMenuFromCatalog
        testId="code-preview-context-menu"
        target={effectiveTarget}
        caps={contextMenuCaps}
        dispatchers={contextMenuDispatchers}
      >
        {pre}
      </ContextMenuFromCatalog>
    );
  }
  return pre;
}
