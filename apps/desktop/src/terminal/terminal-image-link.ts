/**
 * Locating an agent TUI's "open this image" affordance in terminal text.
 *
 * Grok's own TUI prints the generated file's path, then an `[Open Image]`
 * button a few rows below. Clicking it makes Grok open the file on the Host
 * machine, which a remote Desktop never sees. Desktop reads the same rows to
 * learn which file the button refers to and shows it itself.
 */

export const TERMINAL_IMAGE_MARKER = '[Open Image]';
/** The path sits right above its button; never reach into an earlier turn. */
const MAX_PATH_ROWS_ABOVE = 8;
const IMAGE_PATH = /images\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp|gif))(?![A-Za-z0-9._-])/gi;

export type TerminalImageLink = {
  /** Base name inside the session's images directory; never a path. */
  fileName: string;
  /** Cell range of the marker on its row, end exclusive. */
  startCol: number;
  endCol: number;
};

/**
 * `readRow` returns a row's text indexed by terminal cell (one character per
 * cell), or undefined outside the buffer.
 */
export function findTerminalImageLink(
  readRow: (row: number) => string | undefined,
  row: number,
  col: number,
): TerminalImageLink | null {
  const text = readRow(row);
  if (text === undefined) return null;
  let startCol = text.indexOf(TERMINAL_IMAGE_MARKER);
  while (startCol !== -1 && col >= startCol + TERMINAL_IMAGE_MARKER.length) {
    startCol = text.indexOf(TERMINAL_IMAGE_MARKER, startCol + 1);
  }
  if (startCol === -1 || col < startCol) return null;
  for (let above = row - 1; above >= row - MAX_PATH_ROWS_ABOVE; above -= 1) {
    const candidate = readRow(above);
    if (candidate === undefined) break;
    // Another button belongs to another image; its path is not ours.
    if (candidate.includes(TERMINAL_IMAGE_MARKER)) break;
    const names = [...candidate.matchAll(IMAGE_PATH)].map((match) => match[1]);
    const fileName = names[names.length - 1];
    if (fileName !== undefined) {
      return { fileName, startCol, endCol: startCol + TERMINAL_IMAGE_MARKER.length };
    }
  }
  return null;
}
