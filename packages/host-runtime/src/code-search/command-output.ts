/**
 * Output shaping for `restricted_exec`: line-count and character caps plus the
 * `path:line|text` match format the subagent needs in order to cite
 * `<range>` values in its final answer.
 *
 * Truncation markers are the ones observed in recorded Devin tool results:
 * a cut line ends `… (N chars truncated)` and a cut block ends
 * `… (N lines truncated)`.
 */
import { CODE_SEARCH_VIRTUAL_ROOT } from './codebase-paths.js';

/** Cap one line's characters, reporting how many were dropped. */
export function truncateLine(line: string, lineMaxChars: number): string {
  if (line.length <= lineMaxChars) {
    return line;
  }
  const dropped = line.length - lineMaxChars;
  return `${line.slice(0, lineMaxChars)}… (${dropped} chars truncated)`;
}

/**
 * Cap the number of lines. Character capping stays with the caller so a
 * `path:line|text` prefix survives an over-long code line.
 */
export function boundLines(lines: readonly string[], resultMaxLines: number): string {
  const head = lines.slice(0, resultMaxLines);
  const dropped = lines.length - head.length;
  if (dropped > 0) {
    head.push(`… (${dropped} lines truncated)`);
  }
  return head.join('\n');
}

/**
 * Compose a `path:line|text` match line, capping only the code text so the
 * location prefix is never truncated away.
 */
export function numberedLine(prefix: string, text: string, lineMaxChars: number): string {
  return `${prefix}|${truncateLine(text, lineMaxChars)}`;
}

/** Cap both the line count and each line's characters (no prefix to protect). */
export function capPlainLines(
  lines: readonly string[],
  resultMaxLines: number,
  lineMaxChars: number,
): string {
  return boundLines(
    lines.map((line) => truncateLine(line, lineMaxChars)),
    resultMaxLines,
  );
}

/** Render a command target for the framing line (`/codebase/src` → `src`). */
export function summarizeVirtualPath(virtualPath: string): string {
  if (virtualPath === CODE_SEARCH_VIRTUAL_ROOT) {
    return '.';
  }
  return virtualPath.slice(CODE_SEARCH_VIRTUAL_ROOT.length).replace(/^\/+/, '') || '.';
}

/**
 * Split file content into lines the way line numbers are counted: a final
 * newline does not create a phantom last line, and CRLF is normalized so a
 * Windows checkout does not leave `\r` on every rendered line.
 */
export function splitContentLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
