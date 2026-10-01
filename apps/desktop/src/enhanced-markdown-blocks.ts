import type { DiffActionType, EnhancedBlock, EnhancedListItem } from './enhanced-markdown-types.js';

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

export function parseEnhancedMarkdownBlocks(text: string): EnhancedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: EnhancedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Horizontal Rule dividers (---, ***, ___, -----, etc.)
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
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
      if (i < lines.length) i++;
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
    if (trimmed.includes('|') && i + 1 < lines.length && isTableDelimiterLine(lines[i + 1] ?? '')) {
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

        const diffMatch =
          /^\[(MODIFY|NEW|DELETE|RENAME)\]\s*(?:(?:`?([A-Za-z0-9_-]+)`?|\[([A-Za-z0-9_-]+)\])\s+)?(.*)$/i.exec(
            rawContent,
          );
        if (diffMatch && diffMatch[1]) {
          const action = diffMatch[1].toUpperCase() as DiffActionType;
          let ext = diffMatch[2] || diffMatch[3] || '';
          let path = diffMatch[4] || '';

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

    // Standalone Diff items
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

    // Ordered lists (1. 2. …)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: EnhancedListItem[] = [];
      while (i < lines.length) {
        const currentTrimmed = (lines[i] ?? '').trim();
        const itemMatch = /^(\d+)\.\s+(.*)$/.exec(currentTrimmed);
        if (!itemMatch || itemMatch[2] === undefined) break;
        const itemText = itemMatch[2];
        const checkMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
        let checked: boolean | undefined;
        let cleanText = itemText;
        if (checkMatch?.[1] !== undefined && checkMatch[2] !== undefined) {
          checked = checkMatch[1].toLowerCase() === 'x';
          cleanText = checkMatch[2];
        }
        const subItems: string[] = [];
        i++;
        while (i < lines.length) {
          const nextLine = lines[i] ?? '';
          const nextTrimmed = nextLine.trim();
          if (
            /^\s+[-*]\s+/.test(nextLine) ||
            (nextLine.startsWith('  ') && /^[-*]\s+/.test(nextTrimmed))
          ) {
            const subMatch = /^[-*]\s+(.*)$/.exec(nextTrimmed);
            if (subMatch?.[1]) subItems.push(subMatch[1]);
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
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    // Plain blockquotes (non-callout). Callouts (`> [!NOTE]`) are handled above.
    if (trimmed.startsWith('>') && !trimmed.startsWith('> [!')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // Paragraph
    blocks.push({ type: 'paragraph', text: trimmed });
    i++;
  }

  return blocks;
}
