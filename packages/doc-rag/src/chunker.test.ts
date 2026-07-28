import { describe, expect, it } from 'vitest';
import { createDefaultChunker, detectLanguage, isSupportedExtension } from './chunker.js';

const chunker = createDefaultChunker();

describe('chunker', () => {
  describe('detectLanguage / isSupportedExtension', () => {
    it('detects markdown, typescript, python, plain text', () => {
      expect(detectLanguage('docs/intro.md')).toBe('markdown');
      expect(detectLanguage('src/app.tsx')).toBe('typescript');
      expect(detectLanguage('scripts/run.py')).toBe('python');
      expect(detectLanguage('README.txt')).toBe('text');
    });

    it('detects by filename for Dockerfile / Makefile', () => {
      expect(detectLanguage('Dockerfile')).toBe('dockerfile');
      expect(detectLanguage('Makefile')).toBe('makefile');
    });

    it('isSupportedExtension true for known, false for unknown', () => {
      expect(isSupportedExtension('a.md')).toBe(true);
      expect(isSupportedExtension('a.ts')).toBe(true);
      expect(isSupportedExtension('Dockerfile')).toBe(true);
      expect(isSupportedExtension('a.pdf')).toBe(false);
      expect(isSupportedExtension('a.png')).toBe(false);
    });
  });

  describe('chunk markdown', () => {
    it('splits on ATX headings, preserves fenced blocks', () => {
      const content = [
        '# Title',
        '',
        'Intro paragraph.',
        '',
        '## Section A',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '## Section B',
        '',
        'More text.',
      ].join('\n');
      const chunks = chunker.chunk('docs/guide.md', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.every((c) => c.language === 'markdown')).toBe(true);
      expect(chunks.every((c) => c.filePath === 'docs/guide.md')).toBe(true);
      // Fenced block stays inside its section chunk.
      const sectionA = chunks.find((c) => c.content.includes('Section A'));
      expect(sectionA?.content).toContain('const x = 1;');
    });
  });

  describe('chunk code', () => {
    it('splits on top-level function/class declarations', () => {
      const content = [
        'import { foo } from "./foo";',
        '',
        'export function alpha() {',
        '  return 1;',
        '}',
        '',
        'export class Beta {',
        '  method() {}',
        '}',
        '',
        'function gamma() {',
        '  return 3;',
        '}',
      ].join('\n');
      const chunks = chunker.chunk('src/mod.ts', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.every((c) => c.language === 'typescript')).toBe(true);
      const alpha = chunks.find((c) => c.content.includes('alpha'));
      expect(alpha?.content).toContain('return 1;');
    });
  });

  describe('chunk plain text', () => {
    it('splits on double-newline paragraphs', () => {
      const content = 'First paragraph.\n\nSecond paragraph.\n\nThird.';
      const chunks = chunker.chunk('notes.txt', content);
      expect(chunks.length).toBe(3);
      expect(chunks[0]?.content).toBe('First paragraph.');
      expect(chunks[1]?.content).toBe('Second paragraph.');
      expect(chunks[2]?.content).toBe('Third.');
      expect(chunks[0]?.startLine).toBe(1);
      expect(chunks[1]?.startLine).toBe(3);
      expect(chunks[2]?.startLine).toBe(5);
    });
  });

  describe('supportedExtensions', () => {
    it('includes md, ts, py, txt, Dockerfile', () => {
      const exts = chunker.supportedExtensions;
      expect(exts).toContain('.md');
      expect(exts).toContain('.ts');
      expect(exts).toContain('.py');
      expect(exts).toContain('.txt');
    });
  });
});
