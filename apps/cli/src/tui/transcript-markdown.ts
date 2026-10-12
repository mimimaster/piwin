import { Markdown, visibleWidth, wrapTextWithAnsi, type MarkdownTheme } from '@earendil-works/pi-tui';
import { highlightCode } from './code-highlight.js';
import { markdownTheme, style } from './tui-theme.js';

/** pi-tui prints fence lines through `codeBlockBorder`; this marks the ones to drop. */
const DROP_LINE = 'PIWIN_DROP_FENCE_LINE_7f3a';
/**
 * Left gutter of a code block: one cell of dim background then a space. It
 * reads as a bar but is a plain space, so a mouse selection copies only code
 * (plus leading spaces), never box-drawing characters or ``` fences.
 */
export const CODE_GUTTER = `\x1b[100m \x1b[49m `;
const GUTTER_WIDTH = 2;
/** Continuation lines of a wrapped code line sit this much past its own indentation. */
const CONTINUATION_INDENT = 2;
/** Below this the hanging indent is dropped rather than squeezing code to a sliver. */
const MIN_CODE_COLUMNS = 12;

/**
 * Wrap one (possibly highlighted) code line to `width`, continuation lines
 * indented to the line's own indentation plus two, so a wrapped statement
 * still reads as one. Wrapping, not truncation: truncating would hide code
 * the reader cannot otherwise see in a terminal.
 */
export function wrapCodeLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];
  const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
  const leading = plain.length - plain.trimStart().length;
  let hang = leading + CONTINUATION_INDENT;
  if (width - hang < MIN_CODE_COLUMNS) hang = Math.max(0, Math.min(hang, width - MIN_CODE_COLUMNS));
  const [first = '', ...rest] = wrapTextWithAnsi(line, width);
  if (rest.length === 0) return [first];
  // Re-wrap the remainder at the narrower width the hanging indent leaves.
  const remainder = wrapTextWithAnsi(rest.join(' '), Math.max(1, width - hang));
  return [first, ...remainder.map((piece) => `${' '.repeat(hang)}${piece}`)];
}

/**
 * pi-tui's Markdown, adjusted for a transcript:
 * - code blocks drop their ``` fence lines for a gutter and a dim language label;
 * - long code lines wrap with a hanging indent instead of falling back to column 0;
 * - lines are not padded with spaces to the terminal width (the renderer clears
 *   each line itself), so copied text has no trailing whitespace.
 */
export class TranscriptMarkdown {
  private readonly markdown: Markdown;
  private codeWidth = 80;

  public constructor(text: string, private readonly paddingX = 1) {
    const theme: MarkdownTheme = {
      ...markdownTheme,
      codeBlockIndent: CODE_GUTTER,
      codeBlockBorder: (fence) => {
        const lang = fence.replace(/^`+/, '').trim();
        return lang.length === 0 ? DROP_LINE : `${CODE_GUTTER}${style.gray(lang)}`;
      },
      highlightCode: (code, lang) =>
        highlightCode(code, lang).flatMap((line) => wrapCodeLine(line, this.codeWidth)),
    };
    this.markdown = new Markdown(text, paddingX, 0, theme);
  }

  public setText(text: string): void {
    this.markdown.setText(text);
  }

  public invalidate(): void {
    this.markdown.invalidate();
  }

  public render(width: number): string[] {
    this.codeWidth = Math.max(1, width - this.paddingX * 2 - GUTTER_WIDTH);
    return this.markdown
      .render(width)
      .filter((line) => !line.includes(DROP_LINE))
      .map((line) => line.replace(/ +$/, ''));
  }
}
