import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileTypeIcon, resolveFileTypeInfo, type FileTypeInfo } from './file-type-icon.js';

function markupFor(filePathOrExt: string): string {
  return renderToStaticMarkup(createElement(FileTypeIcon, { filePathOrExt }));
}

describe('FileTypeIcon', () => {
  it('resolves common source file groups', () => {
    expect(resolveFileTypeInfo('component.tsx').kind).toBe('react');
    expect(resolveFileTypeInfo('worker.mts').kind).toBe('typescript');
    expect(resolveFileTypeInfo('config.yaml').kind).toBe('json');
    expect(resolveFileTypeInfo('script.zsh').kind).toBe('shell');
    expect(resolveFileTypeInfo('assets/').kind).toBe('folder');
  });

  it('labels jsx as JSX within the react kind', () => {
    const info = resolveFileTypeInfo('widget.jsx');
    expect(info.kind).toBe('react');
    expect(info.ext).toBe('JSX');
  });

  it('renders known file types as tinted tile badges', () => {
    const markup = markupFor('source.ts');
    expect(markup).toContain('<rect');
    expect(markup).toContain('opacity=".15"');
    expect(markup).toContain('file-icon-ts');
    expect(markup).toContain('>TS<');
  });

  it('keeps the TypeScript family on one brand color (ts/tsx/jsx)', () => {
    expect(resolveFileTypeInfo('a.ts').color).toBe(resolveFileTypeInfo('b.tsx').color);
    expect(resolveFileTypeInfo('c.jsx').color).toBe(resolveFileTypeInfo('a.ts').color);
    expect(resolveFileTypeInfo('a.ts').color).toBe('#3178C6');
  });

  it('keeps folder and generic as stroke-only glyphs without tiles', () => {
    const folderMarkup = markupFor('assets/');
    const genericMarkup = markupFor('data.unknownext');
    expect(folderMarkup).not.toContain('<rect');
    expect(folderMarkup).toContain('file-icon-folder');
    expect(genericMarkup).not.toContain('<rect');
    expect(genericMarkup).toContain('file-icon-generic');
  });

  it('uses symbol glyphs for config/markup types on tiles', () => {
    expect(markupFor('data.json')).toContain('file-icon-json');
    expect(markupFor('index.html')).toContain('file-icon-html');
    expect(markupFor('run.sh')).toContain('file-icon-shell');
  });

  it('palette stays in one accessible luminance band (≥3.5:1 on white)', () => {
    const kinds: Array<[string, FileTypeInfo]> = [
      ['a.ts', resolveFileTypeInfo('a.ts')],
      ['a.tsx', resolveFileTypeInfo('a.tsx')],
      ['a.js', resolveFileTypeInfo('a.js')],
      ['a.py', resolveFileTypeInfo('a.py')],
      ['a.json', resolveFileTypeInfo('a.json')],
      ['a.css', resolveFileTypeInfo('a.css')],
      ['a.md', resolveFileTypeInfo('a.md')],
      ['a.html', resolveFileTypeInfo('a.html')],
      ['a.rs', resolveFileTypeInfo('a.rs')],
      ['a.go', resolveFileTypeInfo('a.go')],
      ['a.sh', resolveFileTypeInfo('a.sh')],
      ['a.png', resolveFileTypeInfo('a.png')],
      ['folder', resolveFileTypeInfo('folder/')],
      ['generic', resolveFileTypeInfo('file.xyz')],
    ];

    const channel = (hex: string, offset: number): number => {
      const c = parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string): number => {
      const [r, g, b]: [number, number, number] = [channel(hex, 0), channel(hex, 2), channel(hex, 4)];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastOnWhite = (hex: string): number => (1.05) / (luminance(hex) + 0.05);

    for (const [name, info] of kinds) {
      expect(contrastOnWhite(info.color), `${name} → ${info.color}`).toBeGreaterThanOrEqual(3.5);
    }
  });
});
