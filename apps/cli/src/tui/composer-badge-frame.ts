import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui';
import { style } from './tui-style.js';

const MAX_NAME_WIDTH = 16;
const ANSI = /\x1b\[[0-9;]*m/g;

/** `◆编排 <name> │ `, the name clipped so the composer keeps most of the row. */
export function composerBadgeText(name: string): string {
  return `◆编排 ${truncateToWidth(name, MAX_NAME_WIDTH, '…')} │ `;
}

/**
 * Draws a badge to the left of the composer while an orchestration scheme is
 * active. The editor renders narrower; its border rows are extended with
 * border dashes and its other rows indented, so the box stays one piece.
 * Focus and input stay on the editor itself.
 */
export class ComposerBadgeFrame implements Component {
  public constructor(
    private readonly editor: Component,
    private readonly badgeName: () => string | undefined,
  ) {}

  public invalidate(): void {
    this.editor.invalidate();
  }

  public render(width: number): string[] {
    const name = this.badgeName();
    if (name === undefined) return this.editor.render(width);
    const text = composerBadgeText(name);
    const badgeWidth = visibleWidth(text);
    // Too narrow to share the row: the footer still names the scheme.
    if (width - badgeWidth < 12) return this.editor.render(width);
    const lines = this.editor.render(width - badgeWidth);
    const dashes = style.gray('─'.repeat(badgeWidth));
    const blank = ' '.repeat(badgeWidth);
    const badge = style.bold(style.magenta(text.slice(0, -2))) + style.gray(text.slice(-2));
    return lines.map((line, index) => {
      if (index === 1) return badge + line;
      return line.replace(ANSI, '').startsWith('─') ? dashes + line : blank + line;
    });
  }
}
