import type { Component } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { ComposerBadgeFrame, composerBadgeText } from './composer-badge-frame.js';

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

class FakeEditor implements Component {
  public widths: number[] = [];
  public invalidate(): void {}
  public render(width: number): string[] {
    this.widths.push(width);
    return ['─'.repeat(width), ' 你好'.padEnd(width), ' 第二行'.padEnd(width), '─'.repeat(width)];
  }
}

describe('ComposerBadgeFrame', () => {
  it('renders the editor untouched while freehand', () => {
    const editor = new FakeEditor();
    expect(new ComposerBadgeFrame(editor, () => undefined).render(40)).toEqual(editor.render(40));
  });

  it('puts the badge left of the first input row and keeps the box whole', () => {
    const editor = new FakeEditor();
    const lines = new ComposerBadgeFrame(editor, () => 'Ultra Code').render(60).map(strip);
    const badge = composerBadgeText('Ultra Code');
    expect(badge).toBe('◆编排 Ultra Code │ ');
    expect(lines[1]?.startsWith('◆编排 Ultra Code │  你好')).toBe(true);
    expect(lines[0]).toMatch(/^─+$/);
    expect(lines[3]).toMatch(/^─+$/);
    expect(lines[2]?.startsWith(' '.repeat(19) + ' 第二行')).toBe(true);
    expect(editor.widths[0]).toBe(60 - 19);
  });

  it('clips a long scheme name and gives up the badge on a narrow terminal', () => {
    expect(composerBadgeText('一个名字特别特别特别长的编排方案')).toContain('…');
    const editor = new FakeEditor();
    new ComposerBadgeFrame(editor, () => 'Ultra Code').render(25);
    expect(editor.widths[0]).toBe(25);
  });
});
