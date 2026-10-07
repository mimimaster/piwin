import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { PathChip } from './path-chip';
import { MathView } from './markdown-math-view.js';
import type { DiffActionType } from './enhanced-markdown-types.js';

export function DiffBadge({ action }: { action: DiffActionType }): ReactElement {
  const toneClass =
    action === 'MODIFY'
      ? 'badge-modify'
      : action === 'NEW'
        ? 'badge-new'
        : action === 'DELETE'
          ? 'badge-delete'
          : 'badge-rename';

  return <span className={`diff-action-badge ${toneClass}`}>[{action}]</span>;
}

export function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="compact"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* ignore */
          }
        })();
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * Format inline text with inline code (`code`), strong (**text**), math ($...$), and links ([title](url)).
 */
export function renderFormattedText(
  text: string,
  onOpenFile?: ((filePath: string) => void) | undefined,
  projectPath?: string | undefined,
): Array<string | ReactElement> {
  const parts: Array<string | ReactElement> = [];
  let key = 0;

  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\$[^$\n]+\$|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      const codeContent = matchedStr.slice(1, -1);
      const isPath =
        /(?:^|\/|[A-Za-z]:[\\/])[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.[a-zA-Z0-9]+$/i.test(codeContent) ||
        /^\/(?:[a-zA-Z0-9_\u4e00-\u9fa5.-]+\/)+$/i.test(codeContent) ||
        /^[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.(?:ts|tsx|js|jsx|py|json|css|scss|md|html|rs|go|sh|png|jpg|svg)$/i.test(
          codeContent,
        );

      if (isPath) {
        parts.push(
          <PathChip
            key={key++}
            fullPath={codeContent}
            showIcon={true}
            {...(projectPath ? { projectPath } : {})}
            onOpen={() => onOpenFile?.(codeContent)}
          />,
        );
      } else {
        parts.push(
          <code key={key++} className="enhanced-inline-code">
            {codeContent}
          </code>,
        );
      }
    } else if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
      parts.push(
        <strong key={key++} className="enhanced-strong">
          {matchedStr.slice(2, -2)}
        </strong>,
      );
    } else if (matchedStr.startsWith('*') && matchedStr.endsWith('*')) {
      parts.push(<em key={key++}>{matchedStr.slice(1, -1)}</em>);
    } else if (matchedStr.startsWith('$') && matchedStr.endsWith('$')) {
      const tex = matchedStr.slice(1, -1);
      parts.push(
        <MathView key={key++} tex={tex} display={false} className="enhanced-math-inline" />,
      );
    } else if (matchedStr.startsWith('[') && matchedStr.includes('](')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(matchedStr);
      if (linkMatch && linkMatch[1] && linkMatch[2]) {
        parts.push(
          <a
            key={key++}
            href={linkMatch[2]}
            className="enhanced-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        parts.push(matchedStr);
      }
    } else {
      parts.push(matchedStr);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
