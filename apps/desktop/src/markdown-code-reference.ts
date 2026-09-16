import { languageFromPath } from './syntax-highlight.js';

export type CodeReferenceFence = {
  startLine: number;
  endLine: number;
  path: string;
  /** Shiki language id inferred from the path extension. */
  language: string;
};

const CODE_REFERENCE_PATTERN = /^(\d+):(\d+):(\S+)$/;

/**
 * Agents quote existing code as ```startLine:endLine:path. CommonMark only sees
 * an opaque info word, so the language, gutter offset, and file name have to be
 * recovered here.
 */
export function parseCodeReferenceFence(language: string): CodeReferenceFence | null {
  const match = CODE_REFERENCE_PATTERN.exec(language.trim());
  if (!match) return null;
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  const path = match[3] ?? '';
  if (startLine < 1 || endLine < startLine || !path) return null;
  return { startLine, endLine, path, language: languageFromPath(path) };
}

export function fileNameFromCodeReferencePath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Strip the indentation every non-blank line shares. Excerpts lifted from the
 * middle of a file otherwise start dozens of columns in. Tabs and spaces are
 * only removed as an exact shared prefix, so mixed indentation is left intact.
 */
export function dedentCodeLines(lines: readonly string[]): string[] {
  let prefix: string | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (prefix === null) {
      prefix = indent;
    } else {
      let shared = 0;
      while (shared < prefix.length && shared < indent.length && prefix[shared] === indent[shared]) {
        shared += 1;
      }
      prefix = prefix.slice(0, shared);
    }
    if (prefix === '') return [...lines];
  }
  if (!prefix) return [...lines];
  const width = prefix.length;
  return lines.map((line) => (line.startsWith(prefix!) ? line.slice(width) : line.trimStart()));
}
