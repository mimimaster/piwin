import { useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { TokenSpans, type TokenLine } from './syntax-highlight.js';

const LINES_PER_GROUP = 80;

/** Keep selectable/searchable source in the DOM; color only nearby groups. */
export function CodePreviewLines(props: {
  lines: string[];
  tokens: TokenLine[] | null;
  gutterWidth: number;
  preRef: RefObject<HTMLPreElement | null>;
}): ReactElement {
  const groups = useMemo(() => {
    const result: string[][] = [];
    for (let start = 0; start < props.lines.length; start += LINES_PER_GROUP) {
      result.push(props.lines.slice(start, start + LINES_PER_GROUP));
    }
    return result;
  }, [props.lines]);
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0]));

  useEffect(() => {
    setVisible(new Set([0]));
    const pre = props.preRef.current;
    if (!pre || typeof IntersectionObserver === 'undefined') return;
    const pending = new Set([0]);
    const commitVisible = (): void => {
      const selection = window.getSelection();
      // Replacing a selected token with plain text destroys its native Range.
      // Keep the current colors while selecting; source still scrolls normally.
      if (
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        selection.getRangeAt(0).intersectsNode(pre)
      )
        return;
      setVisible(new Set(pending));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.codeGroup);
          if (entry.isIntersecting) pending.add(index);
          else pending.delete(index);
        }
        commitVisible();
      },
      { rootMargin: '400px 0px' },
    );
    pre.querySelectorAll('[data-code-group]').forEach((node) => observer.observe(node));
    document.addEventListener('selectionchange', commitVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', commitVisible);
    };
  }, [groups, props.preRef]);

  return (
    <>
      {groups.map((lines, groupIndex) => (
        <div key={groupIndex} data-code-group={groupIndex} className="code-preview-group">
          {lines.map((line, localIndex) => {
            const index = groupIndex * LINES_PER_GROUP + localIndex;
            const tokens = visible.has(groupIndex) ? props.tokens?.[index] : null;
            return (
              <div key={index} className="code-preview-row" data-line={index + 1}>
                <span className="code-preview-lineno" aria-hidden="true">
                  {String(index + 1).padStart(props.gutterWidth, ' ')}
                </span>
                <span className="code-preview-text">
                  {tokens ? <TokenSpans tokens={tokens} /> : line}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
