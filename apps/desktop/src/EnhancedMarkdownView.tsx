import { useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@piwin/ui-kit';
import { PathChip } from './path-chip';
import { MermaidBlock } from './MermaidBlock';
import { renderKatex, isMermaidFenceLanguage, isMathFenceLanguage } from './markdown-math';

export type EnhancedMarkdownViewProps = {
  text: string;
  onOpenFile?: ((filePath: string) => void) | undefined;
};

export function EnhancedMarkdownView({
  text,
  onOpenFile,
}: EnhancedMarkdownViewProps): ReactElement {
  const blocks = parseEnhancedMarkdownBlocks(text);

  return (
    <div className="enhanced-markdown-root" data-testid="enhanced-markdown">
      {blocks.map((block, index) => (
        <EnhancedBlockView key={index} block={block} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}

type DiffActionType = 'MODIFY' | 'NEW' | 'DELETE' | 'RENAME';

type EnhancedBlock =
  | {
      type: 'heading';
      level: number;
      text: string;
      action?: DiffActionType | undefined;
      ext?: string | undefined;
      path?: string | undefined;
    }
  | {
      type: 'diff-header';
      action: DiffActionType;
      ext?: string | undefined;
      path: string;
      description?: string | undefined;
    }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: EnhancedListItem[] }
  | { type: 'code'; language: string; source: string }
  | { type: 'details'; summary: string; content: string }
  | { type: 'callout'; kind: 'note' | 'tip' | 'important' | 'warning' | 'caution'; text: string }
  | {
      type: 'table';
      headers: string[];
      alignments: ('left' | 'center' | 'right' | 'default')[];
      rows: string[][];
    };

type EnhancedListItem = {
  text: string;
  checked?: boolean | undefined;
  subItems?: string[] | undefined;
};

function parseTableRow(line: string): string[] {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);
  return content.split('|').map((cell) => cell.trim());
}

function parseTableAlignment(delimiterCell: string): 'left' | 'center' | 'right' | 'default' {
  const cell = delimiterCell.trim();
  const starts = cell.startsWith(':');
  const ends = cell.endsWith(':');
  if (starts && ends) return 'center';
  if (ends) return 'right';
  if (starts) return 'left';
  return 'default';
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(trimmed);
}

function parseEnhancedMarkdownBlocks(text: string): EnhancedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: EnhancedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code blocks
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      blocks.push({
        type: 'code',
        language,
        source: codeLines.join('\n'),
      });
      continue;
    }

    // HTML <details><summary> blocks
    if (trimmed.toLowerCase().startsWith('<details')) {
      let summaryText = 'Details';
      const detailLines: string[] = [];
      const inlineSummaryMatch = /<summary>(.*?)<\/summary>/i.exec(line);
      if (inlineSummaryMatch && inlineSummaryMatch[1]) {
        summaryText = inlineSummaryMatch[1].trim();
      }
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const curTrimmed = cur.trim();
        if (curTrimmed.toLowerCase().startsWith('</details>')) {
          i++;
          break;
        }
        const sumMatch = /<summary>(.*?)<\/summary>/i.exec(cur);
        if (sumMatch && sumMatch[1]) {
          summaryText = sumMatch[1].trim();
        } else if (
          !curTrimmed.toLowerCase().startsWith('<summary') &&
          !curTrimmed.toLowerCase().startsWith('</summary')
        ) {
          detailLines.push(cur);
        }
        i++;
      }
      blocks.push({
        type: 'details',
        summary: summaryText,
        content: detailLines.join('\n'),
      });
      continue;
    }

    // Tables
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableDelimiterLine(lines[i + 1] ?? '')
    ) {
      const headers = parseTableRow(line);
      const delimiterCells = parseTableRow(lines[i + 1] ?? '');
      const alignments = delimiterCells.map(parseTableAlignment);
      i += 2;

      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').trim() !== '' &&
        !(lines[i] ?? '').trim().startsWith('```') &&
        (lines[i] ?? '').includes('|')
      ) {
        rows.push(parseTableRow(lines[i] ?? ''));
        i++;
      }
      blocks.push({ type: 'table', headers, alignments, rows });
      continue;
    }

    // Callouts (> [!NOTE])
    if (trimmed.startsWith('> [!')) {
      const match = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(trimmed);
      if (match && match[1]) {
        const kind = match[1].toLowerCase() as 'note' | 'tip' | 'important' | 'warning' | 'caution';
        const calloutLines: string[] = [];
        i++;
        while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
          calloutLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
          i++;
        }
        blocks.push({
          type: 'callout',
          kind,
          text: calloutLines.join('\n'),
        });
        continue;
      }
    }

    // Headings (#, ##, ###, ####)
    if (trimmed.startsWith('#')) {
      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        const level = headingMatch[1].length;
        const rawContent = headingMatch[2].trim();

        // Check if heading has [MODIFY], [NEW], [DELETE]
        const diffMatch =
          /^\[(MODIFY|NEW|DELETE|RENAME)\]\s*(?:(?:`?([A-Za-z0-9_-]+)`?|\[([A-Za-z0-9_-]+)\])\s+)?(.*)$/i.exec(
            rawContent,
          );
        if (diffMatch && diffMatch[1]) {
          const action = diffMatch[1].toUpperCase() as DiffActionType;
          let ext = diffMatch[2] || diffMatch[3] || '';
          let path = diffMatch[4] || '';

          // Clean markdown links from path if present: [file basename](url) -> file basename
          const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(path);
          if (linkMatch && linkMatch[1]) {
            path = linkMatch[1];
          }

          if (!ext && path) {
            const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
            if (extMatch && extMatch[1]) {
              ext = extMatch[1].toUpperCase();
            }
          }

          blocks.push({
            type: 'heading',
            level,
            text: rawContent,
            action,
            ext: ext ? ext.toUpperCase() : undefined,
            path,
          });
        } else {
          blocks.push({
            type: 'heading',
            level,
            text: rawContent,
          });
        }
        i++;
        continue;
      }
    }

    // Standard or Diff items ([MODIFY] TS path/to/file.ts without heading)
    const standaloneDiffMatch =
      /^\[(MODIFY|NEW|DELETE|RENAME)\]\s*(?:(?:`?([A-Za-z0-9_-]+)`?|\[([A-Za-z0-9_-]+)\])\s+)?(.*)$/i.exec(
        trimmed,
      );
    if (standaloneDiffMatch && standaloneDiffMatch[1]) {
      const action = standaloneDiffMatch[1].toUpperCase() as DiffActionType;
      let ext = standaloneDiffMatch[2] || standaloneDiffMatch[3] || '';
      let path = standaloneDiffMatch[4] || '';

      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(path);
      if (linkMatch && linkMatch[1]) {
        path = linkMatch[1];
      }

      if (!ext && path) {
        const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
        if (extMatch && extMatch[1]) {
          ext = extMatch[1].toUpperCase();
        }
      }

      blocks.push({
        type: 'diff-header',
        action,
        ext: ext ? ext.toUpperCase() : undefined,
        path,
      });
      i++;
      continue;
    }

    // Bullet lists (- or *)
    if (/^[-*]\s+/.test(trimmed)) {
      const items: EnhancedListItem[] = [];
      while (i < lines.length) {
        const currentLine = lines[i] ?? '';
        const currentTrimmed = currentLine.trim();

        // Top level bullet
        const itemMatch = /^[-*]\s+(.*)$/.exec(currentTrimmed);
        if (itemMatch && itemMatch[1]) {
          const itemText = itemMatch[1];
          const checkMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
          let checked: boolean | undefined;
          let cleanText = itemText;
          if (checkMatch && checkMatch[1] !== undefined && checkMatch[2] !== undefined) {
            checked = checkMatch[1].toLowerCase() === 'x';
            cleanText = checkMatch[2];
          }

          const subItems: string[] = [];
          i++;

          // Collect indented sub-bullets
          while (i < lines.length) {
            const nextLine = lines[i] ?? '';
            const nextTrimmed = nextLine.trim();
            if (
              /^\s+[-*]\s+/.test(nextLine) ||
              (nextLine.startsWith('  ') && /^[-*]\s+/.test(nextTrimmed))
            ) {
              const subMatch = /^[-*]\s+(.*)$/.exec(nextTrimmed);
              if (subMatch && subMatch[1]) {
                subItems.push(subMatch[1]);
              }
              i++;
            } else {
              break;
            }
          }

          items.push({
            text: cleanText,
            ...(checked !== undefined ? { checked } : {}),
            ...(subItems.length > 0 ? { subItems } : {}),
          });
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph
    blocks.push({ type: 'paragraph', text: trimmed });
    i++;
  }

  return blocks;
}

function HeadingElement({
  level,
  className,
  children,
}: {
  level: number;
  className: string;
  children: ReactNode;
}): ReactElement {
  switch (level) {
    case 1:
      return <h1 className={className}>{children}</h1>;
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
    case 5:
      return <h5 className={className}>{children}</h5>;
    default:
      return <h6 className={className}>{children}</h6>;
  }
}

function CodeBlockView({
  language,
  source,
}: {
  language: string;
  source: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const lines = source.split('\n');
  const isDiff =
    language.toLowerCase() === 'diff' ||
    lines.some((l) => l.startsWith('+ ') || l.startsWith('- '));
  const FOLD_THRESHOLD = 16;
  const isLong = lines.length > FOLD_THRESHOLD;
  const visibleLines = isLong && !expanded ? lines.slice(0, FOLD_THRESHOLD) : lines;

  return (
    <div className={`enhanced-code-block${isLong && !expanded ? ' folded' : ''}`}>
      <div className="enhanced-code-header">
        <span className="code-lang">{language || (isDiff ? 'diff' : 'code')}</span>
        <div className="code-header-actions">
          {isLong ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? 'Collapse' : `Expand (${lines.length} lines)`}
            </Button>
          ) : null}
          <CopyButton text={source} />
        </div>
      </div>
      <div className="enhanced-code-body-wrapper">
        <pre className="enhanced-code">
          <code>
            {visibleLines.map((line, idx) => {
              if (isDiff) {
                const isAdd = line.startsWith('+');
                const isDel = line.startsWith('-');
                const lineClass = isAdd
                  ? 'diff-line-add'
                  : isDel
                    ? 'diff-line-delete'
                    : 'diff-line-context';
                return (
                  <div key={idx} className={`diff-line ${lineClass}`}>
                    {line}
                  </div>
                );
              }
              return <div key={idx}>{line}</div>;
            })}
          </code>
        </pre>
        {isLong && !expanded ? <div className="enhanced-code-fade" /> : null}
      </div>
    </div>
  );
}

function EnhancedBlockView({
  block,
  onOpenFile,
}: {
  block: EnhancedBlock;
  onOpenFile?: ((filePath: string) => void) | undefined;
}): ReactElement {
  if (block.type === 'heading') {
    if (block.action && block.path) {
      return (
        <div className={`enhanced-heading-diff level-${block.level}`}>
          <DiffBadge action={block.action} />
          {block.ext ? <span className="ext-badge">{block.ext}</span> : null}
          <PathChip
            fullPath={block.path}
            className="diff-path"
            showIcon={false}
            onOpen={() => onOpenFile?.(block.path!)}
          />
        </div>
      );
    }

    // Format heading with potential scope parens e.g. Desktop App (apps/desktop)
    const scopeMatch = /^(.*?)\s*\(([^)]+)\)$/.exec(block.text);
    if (scopeMatch && scopeMatch[1] && scopeMatch[2]) {
      return (
        <HeadingElement level={block.level} className={`enhanced-heading level-${block.level}`}>
          <span>{renderFormattedText(scopeMatch[1])}</span>
          <span className="heading-scope">({scopeMatch[2]})</span>
        </HeadingElement>
      );
    }

    return (
      <HeadingElement level={block.level} className={`enhanced-heading level-${block.level}`}>
        {renderFormattedText(block.text)}
      </HeadingElement>
    );
  }

  if (block.type === 'diff-header') {
    return (
      <div className="enhanced-diff-header">
        <DiffBadge action={block.action} />
        {block.ext ? <span className="ext-badge">{block.ext}</span> : null}
        <PathChip
          fullPath={block.path}
          className="diff-path"
          showIcon={false}
          onOpen={() => onOpenFile?.(block.path)}
        />
      </div>
    );
  }

  if (block.type === 'details') {
    return (
      <details className="enhanced-details">
        <summary className="enhanced-summary">{block.summary}</summary>
        <div className="enhanced-details-content">
          <EnhancedMarkdownView text={block.content} onOpenFile={onOpenFile} />
        </div>
      </details>
    );
  }

  if (block.type === 'code') {
    if (isMermaidFenceLanguage(block.language)) {
      return <MermaidBlock source={block.source} />;
    }
    if (isMathFenceLanguage(block.language)) {
      const katexResult = renderKatex(block.source, true);
      if (katexResult.ok) {
        return (
          <div
            className="enhanced-math-display"
            dangerouslySetInnerHTML={{ __html: katexResult.html }}
          />
        );
      }
    }
    return <CodeBlockView language={block.language} source={block.source} />;
  }

  if (block.type === 'callout') {
    return (
      <div className={`enhanced-callout callout-${block.kind}`}>
        <div className="callout-title">{block.kind.toUpperCase()}</div>
        <div className="callout-content">{renderFormattedText(block.text)}</div>
      </div>
    );
  }

  if (block.type === 'list') {
    return (
      <ul className="enhanced-list">
        {block.items.map((item, index) => (
          <li key={index} className="enhanced-list-item">
            <div className="item-text">
              {item.checked !== undefined ? (
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  className="enhanced-checkbox"
                />
              ) : null}
              <span>{renderFormattedText(item.text)}</span>
            </div>
            {item.subItems && item.subItems.length > 0 ? (
              <ul className="enhanced-sub-list">
                {item.subItems.map((sub, subIndex) => (
                  <li key={subIndex} className="enhanced-sub-item">
                    {renderFormattedText(sub)}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

function getTextAlign(alignment?: 'left' | 'center' | 'right' | 'default'): 'left' | 'center' | 'right' | undefined {
  if (!alignment || alignment === 'default') return undefined;
  return alignment;
}

  if (block.type === 'table') {
    return (
      <div className="md-table-wrapper" data-testid="enhanced-md-table">
        <table className="md-table">
          <thead>
            <tr>
              {block.headers.map((header, hIdx) => (
                <th key={hIdx} style={{ textAlign: getTextAlign(block.alignments[hIdx]) }}>
                  {renderFormattedText(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} style={{ textAlign: getTextAlign(block.alignments[cIdx]) }}>
                    {renderFormattedText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <p className="enhanced-paragraph">{renderFormattedText(block.text)}</p>;
}

function DiffBadge({ action }: { action: DiffActionType }): ReactElement {
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

function CopyButton({ text }: { text: string }): ReactElement {
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
function renderFormattedText(text: string): Array<string | ReactElement> {
  const parts: Array<string | ReactElement> = [];
  let key = 0;

  // Regex tokenizer for inline markdown constructs
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\$[^$\n]+\$|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      parts.push(
        <code key={key++} className="enhanced-inline-code">
          {matchedStr.slice(1, -1)}
        </code>,
      );
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
      const katexRes = renderKatex(tex, false);
      if (katexRes.ok) {
        parts.push(
          <span
            key={key++}
            className="enhanced-math-inline"
            dangerouslySetInnerHTML={{ __html: katexRes.html }}
          />,
        );
      } else {
        parts.push(matchedStr);
      }
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
