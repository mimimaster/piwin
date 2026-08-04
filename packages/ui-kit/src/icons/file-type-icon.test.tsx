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

  it('preserves TypeScript brand colors', () => {
    const markup = renderToStaticMarkup(
      createElement(FileTypeIcon, { filePathOrExt: 'source.ts' }),
    );

    expect(markup).toContain('stroke="#3178c6"');
    expect(markup).toContain('file-icon-ts');
  });

  it('preserves semantic colors for non-brand file types', () => {
    const markdownMarkup = renderToStaticMarkup(
      createElement(FileTypeIcon, { filePathOrExt: 'README.md' }),
    );
    const imageMarkup = renderToStaticMarkup(
      createElement(FileTypeIcon, { filePathOrExt: 'preview.webp' }),
    );

    expect(markdownMarkup).toContain('stroke="#34d399"');
    expect(imageMarkup).toContain('stroke="#e879f9"');
  });
});
