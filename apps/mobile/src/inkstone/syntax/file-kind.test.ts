import { describe, expect, it } from 'vitest';
import { EXTENSION_LANGUAGES, FILENAME_LANGUAGES, fenceLanguage, filePreviewKind } from './file-kind.js';
import { GRAMMAR_LOADERS } from './grammar-loaders.js';

describe('filePreviewKind', () => {
  it('maps source extensions to Shiki grammars', () => {
    expect(filePreviewKind('apps/mobile/src/App.tsx')).toEqual({ kind: 'code', language: 'tsx' });
    expect(filePreviewKind('src-tauri/src/lib.rs')).toEqual({ kind: 'code', language: 'rust' });
    expect(filePreviewKind('pnpm-lock.yaml')).toEqual({ kind: 'code', language: 'yaml' });
  });

  it('recognises well-known file names without extensions', () => {
    expect(filePreviewKind('deploy/Dockerfile')).toEqual({ kind: 'code', language: 'dockerfile' });
    expect(filePreviewKind('Makefile')).toEqual({ kind: 'code', language: 'make' });
  });

  it('renders markdown and images instead of highlighting them', () => {
    expect(filePreviewKind('README.md')).toEqual({ kind: 'markdown' });
    expect(filePreviewKind('docs/shot.PNG')).toEqual({ kind: 'image', mimeType: 'image/png' });
  });

  it('keeps unknown files as plain text', () => {
    expect(filePreviewKind('notes.txt')).toEqual({ kind: 'text' });
    expect(filePreviewKind('LICENSE')).toEqual({ kind: 'text' });
  });
});

describe('fenceLanguage', () => {
  it('normalises common fence labels and leaves plain text unhighlighted', () => {
    expect(fenceLanguage('ts')).toBe('typescript');
    expect(fenceLanguage('Shell')).toBe('bash');
    expect(fenceLanguage('python')).toBe('python');
    expect(fenceLanguage('')).toBeUndefined();
    expect(fenceLanguage('text')).toBeUndefined();
  });
});

describe('grammar loaders', () => {
  it('ship a grammar for every language the file map can produce', () => {
    const wanted = new Set([...Object.values(EXTENSION_LANGUAGES), ...Object.values(FILENAME_LANGUAGES), 'markdown']);
    expect([...wanted].filter((language) => GRAMMAR_LOADERS[language] === undefined)).toEqual([]);
  });
});
