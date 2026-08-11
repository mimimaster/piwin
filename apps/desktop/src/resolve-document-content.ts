/**
 * Resolve document-panel content when a path is missing on disk.
 *
 * Desktop opens `.md` links and failed write_file targets into the right
 * inspector. When project/read-file fails (permission deny, never written),
 * we recover the best available body from the live transcript.
 *
 * Critical bug this module fixes: a naive "first ``` fence" grab can pick the
 * *middle* of a plan that happens to sit between two TypeScript fences, so the
 * panel shows a half-cut Slice 2-4 fragment instead of the full `# ...` document.
 */

export type DocumentContentMessage = {
  text?: string | undefined;
  tools?:
    | Array<{
        toolName?: string | undefined;
        output?: string | undefined;
        presentation?:
          | {
              inputPreview?: string | undefined;
              targetPaths?: string[] | undefined;
              changedPaths?: string[] | undefined;
            }
          | undefined;
      }>
    | undefined;
};

export type ResolveDocumentContentInput = {
  title: string;
  path: string;
  messages: readonly DocumentContentMessage[];
};

const WRITE_LIKE_TOOL_NAMES = new Set([
  'write',
  'write_file',
  'edit',
  'str_replace',
  'search_replace',
  'apply_patch',
  'apply_diff',
  'multi_edit',
]);

/** Prefer longer, more complete markdown bodies when ranking candidates. */
const MIN_USEFUL_DOCUMENT_CHARS = 80;

/**
 * Walk transcript newest-first and pick the best document body for a path/title.
 * Returns null when nothing usable is found (caller shows a not-found stub).
 */
export function resolveDocumentContentFromMessages(
  input: ResolveDocumentContentInput,
): string | null {
  const cleanTitle = input.title.trim();
  const cleanPath = input.path.trim();
  if (!cleanTitle && !cleanPath) {
    return null;
  }

  let bestCandidate: string | null = null;
  let bestScore = -1;

  for (let messageIndex = input.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = input.messages[messageIndex];
    if (!message) continue;

    for (const tool of message.tools ?? []) {
      const toolCandidate = extractWriteToolDocumentContent(tool, cleanTitle, cleanPath);
      if (toolCandidate) {
        const score = scoreDocumentCandidate(toolCandidate, 'write-tool');
        if (score > bestScore) {
          bestCandidate = toolCandidate;
          bestScore = score;
        }
      }
    }

    const messageText = message.text ?? '';
    if (messageText && mentionsDocument(messageText, cleanTitle, cleanPath)) {
      const fromMessage = extractMarkdownDocumentFromMessage(messageText, cleanTitle, cleanPath);
      if (fromMessage) {
        const score = scoreDocumentCandidate(fromMessage, 'message-body');
        if (score > bestScore) {
          bestCandidate = fromMessage;
          bestScore = score;
        }
      }
    }
  }

  return bestCandidate;
}

function mentionsDocument(text: string, title: string, path: string): boolean {
  if (path && text.includes(path)) return true;
  if (title && text.includes(title)) return true;
  const basenames = collectPathBasenames(path, title);
  return basenames.some((name) => text.includes(name));
}

function collectPathBasenames(path: string, title: string): string[] {
  const names = new Set<string>();
  for (const raw of [path, title]) {
    if (!raw) continue;
    const base = raw.split(/[\\/]/).pop() || raw;
    names.add(base);
    names.add(base.replace(/\.md$/i, ''));
  }
  return [...names].filter((name) => name.length > 0);
}

function extractWriteToolDocumentContent(
  tool: NonNullable<DocumentContentMessage['tools']>[number],
  title: string,
  path: string,
): string | null {
  const toolName = (tool.toolName ?? '').trim().toLowerCase();
  const isWriteLike =
    WRITE_LIKE_TOOL_NAMES.has(toolName) ||
    toolName.endsWith('_write') ||
    toolName.endsWith('_edit');

  const targetPaths = [
    ...(tool.presentation?.targetPaths ?? []),
    ...(tool.presentation?.changedPaths ?? []),
  ];
  const pathMatched =
    targetPaths.some((target) => pathMatches(target, title, path)) ||
    mentionsDocument(tool.presentation?.inputPreview ?? '', title, path) ||
    mentionsDocument(tool.output ?? '', title, path);

  if (!pathMatched) {
    return null;
  }
  if (!isWriteLike && targetPaths.length === 0 && !tool.presentation?.inputPreview) {
    return null;
  }

  const fromPreview = extractContentFieldFromInputPreview(tool.presentation?.inputPreview);
  if (fromPreview && fromPreview.length >= MIN_USEFUL_DOCUMENT_CHARS) {
    return fromPreview;
  }

  const output = (tool.output ?? '').trim();
  if (
    output &&
    !output.toLowerCase().startsWith('permission denied') &&
    !output.toLowerCase().startsWith('error') &&
    output.length >= MIN_USEFUL_DOCUMENT_CHARS &&
    (output.startsWith('#') || output.includes('\n# '))
  ) {
    return output;
  }

  // A short truncated preview must not get the +1000 write-tool bonus and
  // crowd out a longer, complete message-body candidate.
  return null;
}

function pathMatches(candidate: string, title: string, path: string): boolean {
  if (!candidate) return false;
  if (path && (candidate === path || candidate.endsWith(path) || path.endsWith(candidate))) {
    return true;
  }
  const basenames = collectPathBasenames(path, title);
  const candidateBase = candidate.split(/[\\/]/).pop() || candidate;
  return basenames.some(
    (name) =>
      candidateBase === name || candidateBase.replace(/\.md$/i, '') === name.replace(/\.md$/i, ''),
  );
}

/**
 * Parse write_file-style inputPreview JSON and return the `content` field.
 * Tolerates truncated JSON (common when preview was clipped) by recovering the
 * string that starts after `"content":"`.
 */
export function extractContentFieldFromInputPreview(
  inputPreview: string | undefined,
): string | null {
  if (!inputPreview) return null;
  const trimmed = inputPreview.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (typeof record.content === 'string' && record.content.trim()) {
        return record.content;
      }
      if (typeof record.new_string === 'string' && record.new_string.trim()) {
        return record.new_string;
      }
      if (typeof record.newString === 'string' && record.newString.trim()) {
        return record.newString;
      }
    }
  } catch {
    // Fall through to partial recovery.
  }

  return recoverPartialJsonStringField(trimmed, ['content', 'new_string', 'newString']);
}

function recoverPartialJsonStringField(raw: string, fieldNames: string[]): string | null {
  for (const fieldName of fieldNames) {
    const marker = `"${fieldName}"`;
    const fieldIndex = raw.indexOf(marker);
    if (fieldIndex < 0) continue;
    const afterField = raw.slice(fieldIndex + marker.length);
    const colonIndex = afterField.indexOf(':');
    if (colonIndex < 0) continue;
    let cursor = colonIndex + 1;
    while (cursor < afterField.length && /\s/.test(afterField[cursor] ?? '')) {
      cursor += 1;
    }
    if (afterField[cursor] !== '"') continue;
    cursor += 1;
    let result = '';
    let escaped = false;
    for (; cursor < afterField.length; cursor += 1) {
      const character = afterField[cursor] ?? '';
      if (escaped) {
        result += decodeJsonEscape(character);
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        return result;
      }
      result += character;
    }
    // Truncated JSON: the string value never closed. Return what we have —
    // callers gate on MIN_USEFUL_DOCUMENT_CHARS before adopting it.
    if (result.length > 0) {
      return result;
    }
  }
  return null;
}

function decodeJsonEscape(character: string): string {
  switch (character) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    default:
      return character;
  }
}

/**
 * Extract a full markdown document from an assistant message.
 * Prefers a standalone `#` heading section. When the document itself is
 * wrapped in an explicit markdown fence, returns the fence body without its
 * delimiter; headings inside that fence are not treated as outside documents.
 */
export function extractMarkdownDocumentFromMessage(
  text: string,
  title: string,
  path: string,
): string | null {
  if (!text.trim()) return null;

  const fencedDocuments = extractExplicitMarkdownFences(text);
  const headingDocument = extractHeadingDocument(fencedDocuments.outsideText, title, path);
  if (headingDocument) {
    return headingDocument;
  }

  if (fencedDocuments.bestBody && fencedDocuments.bestBody.length >= MIN_USEFUL_DOCUMENT_CHARS) {
    return fencedDocuments.bestBody;
  }

  const headingSource = fencedDocuments.outsideText;
  const looksLikeDocument =
    headingSource.includes('\n# ') || headingSource.trimStart().startsWith('#');
  if (mentionsDocument(headingSource, title, path) && looksLikeDocument) {
    const fromHeading = extractFirstHeadingToEnd(headingSource);
    if (fromHeading && fromHeading.length >= MIN_USEFUL_DOCUMENT_CHARS) {
      return fromHeading;
    }
  }

  return null;
}

function extractHeadingDocument(text: string, title: string, path: string): string | null {
  const headingPattern = /(?:^|\n)(#{1,6}\s+[^\n]+)/g;
  const matches: Array<{ index: number; heading: string }> = [];
  for (const match of text.matchAll(headingPattern)) {
    const heading = match[1] ?? '';
    const matchIndex = match.index ?? 0;
    const absoluteIndex = text[matchIndex] === '\n' ? matchIndex + 1 : matchIndex;
    matches.push({ index: absoluteIndex, heading });
  }
  if (matches.length === 0) {
    return null;
  }

  const basenames = collectPathBasenames(path, title);
  let best: string | null = null;
  let bestScore = -1;

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    if (!current) continue;
    const next = matches[index + 1];
    const body = text.slice(current.index).trim();
    if (body.length < MIN_USEFUL_DOCUMENT_CHARS) continue;

    let score = scoreDocumentCandidate(body, 'message-body');
    const headingLower = current.heading.toLowerCase();
    for (const name of basenames) {
      if (headingLower.includes(name.toLowerCase().replace(/\.md$/i, ''))) {
        score += 500;
      }
    }
    if (/执行计划|设计方案|implementation plan|design|lifecycle|archive/i.test(current.heading)) {
      score += 200;
    }
    const level = (current.heading.match(/^#+/) ?? ['#'])[0]!.length;
    score += Math.max(0, 40 - level * 8);
    if (next === undefined) {
      score += 50;
    }
    if (score > bestScore) {
      best = body;
      bestScore = score;
    }
  }

  return best;
}

function extractFirstHeadingToEnd(text: string): string | null {
  const match = /(?:^|\n)(#\s+[^\n]+[\s\S]*)$/.exec(text);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

function extractExplicitMarkdownFences(text: string): {
  bestBody: string | null;
  outsideText: string;
} {
  const lines = text.split('\n');
  const outsideLines = [...lines];
  let best: string | null = null;
  let bestLength = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const openingMatch = /^(?: {0,3})(`{3,})(?:markdown|md)[ \t]*\r?$/i.exec(line);
    const openingFence = openingMatch?.[1];
    if (!openingFence) {
      continue;
    }

    let closingLineIndex: number | null = null;
    for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
      const candidateLine = lines[candidateIndex] ?? '';
      const closingMatch = /^(?: {0,3})(`{3,})[ \t]*\r?$/.exec(candidateLine);
      const closingFence = closingMatch?.[1];
      if (closingFence && closingFence.length >= openingFence.length) {
        closingLineIndex = candidateIndex;
        break;
      }
    }

    if (closingLineIndex === null) {
      continue;
    }

    const body = lines
      .slice(lineIndex + 1, closingLineIndex)
      .join('\n')
      .trim();
    for (let maskedIndex = lineIndex; maskedIndex <= closingLineIndex; maskedIndex += 1) {
      outsideLines[maskedIndex] = '';
    }
    if (body.length > bestLength) {
      best = body;
      bestLength = body.length;
    }
    lineIndex = closingLineIndex;
  }

  return {
    bestBody: best,
    outsideText: outsideLines.join('\n'),
  };
}

function scoreDocumentCandidate(content: string, source: 'write-tool' | 'message-body'): number {
  let score = content.length;
  if (source === 'write-tool') {
    score += 1_000;
  }
  if (content.trimStart().startsWith('#')) {
    score += 300;
  }
  if (!/^#{1,6}\s+/m.test(content.slice(0, 200)) && content.includes('Slice ')) {
    score -= 400;
  }
  if (/^(?:import |export |type |const |function )/m.test(content.trimStart())) {
    score -= 300;
  }
  return score;
}
