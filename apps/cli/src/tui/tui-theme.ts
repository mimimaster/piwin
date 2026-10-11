import { highlightCode } from './code-highlight.js';
import { style } from './tui-style.js';
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui';

/**
 * Terminal styling for the TUI. Only the 16 base ANSI colors and attributes
 * are used, so the palette follows whatever theme the terminal (or Desktop's
 * xterm surface) already has instead of fighting it.
 */

export { style };

export const selectListTheme: SelectListTheme = {
  selectedPrefix: style.cyan,
  selectedText: style.cyan,
  description: style.gray,
  scrollInfo: style.gray,
  noMatch: style.gray,
};

export const editorTheme: EditorTheme = {
  borderColor: style.gray,
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => style.bold(style.cyan(text)),
  link: style.blue,
  linkUrl: style.gray,
  code: style.yellow,
  codeBlock: (text) => text,
  highlightCode,
  codeBlockBorder: style.gray,
  quote: style.italic,
  quoteBorder: style.gray,
  hr: style.gray,
  listBullet: style.cyan,
  bold: style.bold,
  italic: style.italic,
  strikethrough: style.strikethrough,
  underline: style.underline,
};
