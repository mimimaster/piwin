/**
 * Flat `key: value` YAML frontmatter of a SKILL.md, including folded/literal
 * multiline block scalars (`>`, `>-`, `|`, `|-`) and unquoted continuations;
 * nested YAML structures are skipped without leaking into top-level keys.
 */
export function parseSkillFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = (match[1] ?? '').split(/\r?\n/);
  const result: Record<string, string> = {};

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#') || /^\s/.test(line)) {
      index += 1;
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      index += 1;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1);
    const trimmedValue = rawValue.trim();

    if (!key) {
      index += 1;
      continue;
    }

    if (/^[>|][+-]?$/.test(trimmedValue)) {
      const folded = trimmedValue.startsWith('>');
      const collected: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const candidate = lines[nextIndex] ?? '';
        if (candidate.trim() === '' || /^\s+/.test(candidate)) {
          collected.push(candidate);
          nextIndex += 1;
        } else {
          break;
        }
      }
      result[key] = formatBlockScalar(collected, folded);
      index = nextIndex;
      continue;
    }

    if (trimmedValue === '') {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && (lines[nextIndex] ?? '').trim() === '') {
        nextIndex += 1;
      }
      if (nextIndex < lines.length && /^\s+/.test(lines[nextIndex] ?? '')) {
        while (nextIndex < lines.length) {
          const candidate = lines[nextIndex] ?? '';
          if (candidate.trim() === '' || /^\s+/.test(candidate)) {
            nextIndex += 1;
          } else {
            break;
          }
        }
        index = nextIndex;
        continue;
      }
      index += 1;
      continue;
    }

    const isQuoted =
      (trimmedValue.startsWith('"') && trimmedValue.endsWith('"') && trimmedValue.length >= 2) ||
      (trimmedValue.startsWith("'") && trimmedValue.endsWith("'") && trimmedValue.length >= 2);
    let value = trimmedValue.replace(/^["']|["']$/g, '');
    let nextIndex = index + 1;
    if (!isQuoted) {
      const continuations: string[] = [];
      while (nextIndex < lines.length) {
        const candidate = lines[nextIndex] ?? '';
        const candidateTrimmed = candidate.trim();
        if (/^\s+/.test(candidate) && candidateTrimmed && !candidateTrimmed.startsWith('- ')) {
          continuations.push(candidateTrimmed);
          nextIndex += 1;
        } else {
          break;
        }
      }
      if (continuations.length > 0) {
        value = [value, ...continuations].join(' ');
      }
    }
    result[key] = value;
    index = nextIndex;
  }

  return result;
}

function formatBlockScalar(lines: readonly string[], folded: boolean): string {
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim() === '') {
    start += 1;
  }
  let end = lines.length;
  while (end > start && (lines[end - 1] ?? '').trim() === '') {
    end -= 1;
  }
  const trimmedSlice = lines.slice(start, end);
  if (trimmedSlice.length === 0) return '';

  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of trimmedSlice) {
    if (line.trim() === '') continue;
    const indentMatch = line.match(/^(\s+)/);
    const indentLen = indentMatch?.[1]?.length ?? 0;
    if (indentLen < minIndent) {
      minIndent = indentLen;
    }
  }
  const dedented = trimmedSlice.map((line) =>
    line.trim() === '' ? '' : line.slice(Number.isFinite(minIndent) ? minIndent : 0),
  );

  if (!folded) {
    return dedented.join('\n').trim();
  }

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];
  for (const line of dedented) {
    if (line === '') {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join(' '));
        currentParagraph = [];
      }
    } else {
      currentParagraph.push(line.trim());
    }
  }
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}
