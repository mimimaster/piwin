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

  it('resolves dedicated config and ecosystem files', () => {
    expect(resolveFileTypeInfo('.gitignore').kind).toBe('git');
    expect(resolveFileTypeInfo('package.json').kind).toBe('npm');
    expect(resolveFileTypeInfo('pnpm-lock.yaml').kind).toBe('pnpm');
    expect(resolveFileTypeInfo('yarn.lock').kind).toBe('yarn');
    expect(resolveFileTypeInfo('eslint.config.js').kind).toBe('eslint');
    expect(resolveFileTypeInfo('.prettierrc').kind).toBe('prettier');
    expect(resolveFileTypeInfo('.env.local').kind).toBe('env');
    expect(resolveFileTypeInfo('Dockerfile').kind).toBe('docker');
    expect(resolveFileTypeInfo('logo.svg').kind).toBe('svg');
  });

  it('renders known file types as official material SVG markup', () => {
    const markup = markupFor('source.ts');
    expect(markup).toContain('file-icon-typescript');
    expect(markup).toContain('<svg');
  });

  it('renders react as official react_ts icon', () => {
    const tsxMarkup = markupFor('component.tsx');
    expect(tsxMarkup).toContain('file-icon-react_ts');
    expect(tsxMarkup).toContain('<svg');
  });

  it('renders git with official git icon', () => {
    const gitMarkup = markupFor('.gitignore');
    expect(gitMarkup).toContain('file-icon-git');
    expect(gitMarkup).toContain('<svg');
  });

  it('renders npm and pnpm with official icons', () => {
    const npmMarkup = markupFor('package.json');
    expect(npmMarkup).toContain('file-icon-nodejs');
    const pnpmMarkup = markupFor('pnpm-lock.yaml');
    expect(pnpmMarkup).toContain('file-icon-pnpm');
  });

  it('renders folders with dedicated folder icon', () => {
    const folderMarkup = markupFor('assets/');
    expect(folderMarkup).toContain('file-icon-folder');
    expect(folderMarkup).toContain('<svg');
  });
});
