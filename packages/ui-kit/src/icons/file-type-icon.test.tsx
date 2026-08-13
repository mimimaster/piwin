import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileTypeIcon, resolveFileTypeInfo } from './file-type-icon.js';

describe('FileTypeIcon', () => {
  it('resolves common source file groups', () => {
    expect(resolveFileTypeInfo('component.tsx').kind).toBe('react');
    expect(resolveFileTypeInfo('worker.mts').kind).toBe('typescript');
    expect(resolveFileTypeInfo('config.yaml').kind).toBe('json');
    expect(resolveFileTypeInfo('script.zsh').kind).toBe('shell');
    expect(resolveFileTypeInfo('assets/').kind).toBe('folder');
  });

  it('preserves TypeScript brand colors and clean text badge without background tile', () => {
    const markup = renderToStaticMarkup(
      createElement(FileTypeIcon, { filePathOrExt: 'source.ts' }),
    );

    expect(markup).toContain('fill="#5B9DE8"');
    expect(markup).toContain('file-icon-ts');
    expect(markup).toContain('>TS<');
    expect(markup).not.toContain('<rect');
  });

  it('preserves semantic colors for non-brand file types without background tiles', () => {
    const markdownMarkup = renderToStaticMarkup(
      createElement(FileTypeIcon, { filePathOrExt: 'README.md' }),
    );
    const imageMarkup = renderToStaticMarkup(
      createElement(FileTypeIcon, { filePathOrExt: 'preview.webp' }),
    );

    expect(markdownMarkup).toContain('stroke="#8FBFB0"');
    expect(markdownMarkup).not.toContain('<rect');
    expect(imageMarkup).toContain('stroke="#C687B6"');
    expect(imageMarkup).not.toContain('<rect');
  });
});
