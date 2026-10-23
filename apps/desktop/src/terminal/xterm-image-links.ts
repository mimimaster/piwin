/**
 * Pointer handling for an agent TUI's `[Open Image]` button inside xterm.
 *
 * The TUI tracks the mouse, so a click on the button would also reach it and
 * make it open the file on the Host machine. Listening in the capture phase
 * on the terminal's container takes the click before xterm reports it.
 */
import type { Terminal } from '@xterm/xterm';
import { findTerminalImageLink, type TerminalImageLink } from './terminal-image-link.js';

const LINK_CLASS = 'has-terminal-image-link';

export function attachXtermImageLinks(
  terminal: Terminal,
  container: HTMLElement,
  onOpen: (fileName: string) => void,
): () => void {
  const readRow = (row: number): string | undefined => {
    const buffer = terminal.buffer.active;
    const line = buffer.getLine(buffer.viewportY + row);
    if (line === undefined) return undefined;
    let text = '';
    // One character per cell: the trailing half of a wide glyph keeps its slot.
    for (let col = 0; col < terminal.cols; col += 1) text += line.getCell(col)?.getChars().charAt(0) || ' ';
    return text;
  };
  const linkAt = (event: MouseEvent): TerminalImageLink | null => {
    const screen = container.querySelector('.xterm-screen');
    if (screen === null) return null;
    const rect = screen.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const col = Math.floor((event.clientX - rect.left) / (rect.width / terminal.cols));
    const row = Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows));
    if (col < 0 || row < 0 || col >= terminal.cols || row >= terminal.rows) return null;
    return findTerminalImageLink(readRow, row, col);
  };
  const swallow = (event: MouseEvent): TerminalImageLink | null => {
    if (event.button !== 0) return null;
    const link = linkAt(event);
    if (link === null) return null;
    event.preventDefault();
    event.stopPropagation();
    return link;
  };
  const onDown = (event: MouseEvent): void => { swallow(event); };
  const onUp = (event: MouseEvent): void => {
    const link = swallow(event);
    if (link !== null) onOpen(link.fileName);
  };
  const onMove = (event: MouseEvent): void => {
    container.classList.toggle(LINK_CLASS, linkAt(event) !== null);
  };
  const onLeave = (): void => { container.classList.remove(LINK_CLASS); };
  container.addEventListener('mousedown', onDown, true);
  container.addEventListener('mouseup', onUp, true);
  container.addEventListener('click', onDown, true);
  container.addEventListener('mousemove', onMove, true);
  container.addEventListener('mouseleave', onLeave);
  return () => {
    container.removeEventListener('mousedown', onDown, true);
    container.removeEventListener('mouseup', onUp, true);
    container.removeEventListener('click', onDown, true);
    container.removeEventListener('mousemove', onMove, true);
    container.removeEventListener('mouseleave', onLeave);
    container.classList.remove(LINK_CLASS);
  };
}
