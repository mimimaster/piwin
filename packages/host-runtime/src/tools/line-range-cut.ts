/**
 * Cut a 1-based, inclusive line range out of a text, checked against the
 * first and last line the caller believes it is cutting.
 *
 * Moving a block by quoting it (an `edit` whose `oldText` is the whole block,
 * then a `write_file` with the same text again) costs the block twice in output
 * tokens, which is why models reach for `sed -n 'X,Yp'` in a shell. A range is
 * cheap but easy to get off by a few lines, so the caller must also name the
 * range's first and last line; a mismatch is refused with the lines actually
 * there and where the quoted line does occur, so one retry fixes it.
 *
 * Line endings are kept as found: a `\r` stays on its line, and is ignored
 * only when comparing the quoted text.
 */

export type LineRangeCutInput = {
  text: string;
  startLine: number;
  endLine: number;
  /** The range's first line as the caller sees it (indentation and trailing space ignored). */
  startText: string;
  /** The range's last line as the caller sees it. */
  endText: string;
  /** Text left where the range was (default: nothing). */
  replacement?: string;
};

export type LineRangeCut =
  | {
      ok: true;
      /** The text with the range removed (and `replacement` in its place). */
      remaining: string;
      /** The cut lines, each newline-terminated. */
      block: string;
      lineCount: number;
    }
  | { ok: false; message: string };

/** Lines of `text`; a trailing newline does not make an extra empty line. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const compareForm = (line: string): string => line.replace(/\r$/, '').trim();

/** Where else in the file a quoted line occurs, to help fix a mis-numbered range. */
function nearbyMatches(lines: readonly string[], quoted: string): string {
  const wanted = compareForm(quoted);
  const found: number[] = [];
  for (let index = 0; index < lines.length && found.length < 5; index += 1) {
    if (compareForm(lines[index] ?? '') === wanted) found.push(index + 1);
  }
  return found.length === 0 ? 'it does not appear in the file' : `it appears at line ${found.join(', ')}`;
}

function checkEnd(
  lines: readonly string[],
  lineNumber: number,
  quoted: string,
  which: 'startText' | 'endText',
): string | undefined {
  const actual = lines[lineNumber - 1] ?? '';
  if (compareForm(actual) === compareForm(quoted)) return undefined;
  return `${which} does not match line ${lineNumber}, which is ${JSON.stringify(compareForm(actual))}; ${nearbyMatches(lines, quoted)}. Nothing was changed.`;
}

export function cutLineRange(input: LineRangeCutInput): LineRangeCut {
  const lines = splitLines(input.text);
  const { startLine, endLine } = input;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return { ok: false, message: 'startLine and endLine must be whole numbers with 1 <= startLine <= endLine.' };
  }
  if (endLine > lines.length) {
    return {
      ok: false,
      message: `endLine ${endLine} is past the end of the file, which has ${lines.length} lines. Nothing was changed.`,
    };
  }
  const mismatch =
    checkEnd(lines, startLine, input.startText, 'startText') ??
    checkEnd(lines, endLine, input.endText, 'endText');
  if (mismatch !== undefined) return { ok: false, message: mismatch };

  const cut = lines.slice(startLine - 1, endLine);
  const left = lines.slice(0, startLine - 1);
  const right = lines.slice(endLine);
  const replacement = input.replacement ?? '';
  const inserted = replacement === '' ? [] : splitLines(replacement);
  const remaining = [...left, ...inserted, ...right];
  // A file without a final newline keeps that habit while its last line stays
  // last; once the cut reaches the end, the new last line is an ordinary one.
  const terminal = right.length > 0 && !input.text.endsWith('\n') ? '' : '\n';
  return {
    ok: true,
    remaining: remaining.length === 0 ? '' : remaining.join('\n') + terminal,
    block: `${cut.join('\n')}\n`,
    lineCount: cut.length,
  };
}
