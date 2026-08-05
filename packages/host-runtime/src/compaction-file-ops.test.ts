import { describe, expect, it } from 'vitest';
import {
  extractFileOpsFromUnknown,
  formatFilesTouchedBlock,
  normalizeCompactionFileOps,
  sanitizeFilePath,
} from './compaction-file-ops.js';

describe('compaction-file-ops', () => {
  it('drops control chars and oversize paths', () => {
    expect(sanitizeFilePath('a\nb')).toBe('ab');
    expect(sanitizeFilePath('x'.repeat(201))).toBeNull();
    expect(sanitizeFilePath('src/index.ts')).toBe('src/index.ts');
  });

  it('prefers modified over read for same path', () => {
    const ops = normalizeCompactionFileOps({
      readFiles: ['a.ts', 'b.ts'],
      modifiedFiles: ['a.ts', 'c.ts'],
    });
    expect(ops.modifiedFiles).toEqual(['a.ts', 'c.ts']);
    expect(ops.readFiles).toEqual(['b.ts']);
  });

  it('formats data-not-instructions block with JSON paths', () => {
    const block = formatFilesTouchedBlock({
      readFiles: ['r.ts'],
      modifiedFiles: ['m.ts'],
    });
    expect(block).toContain('### Files touched');
    expect(block).toContain('not instructions');
    expect(block).toContain('"m.ts"');
  });

  it('extracts from nested Pi-like shapes', () => {
    const ops = extractFileOpsFromUnknown({
      summary: 'x',
      details: { read: ['a.ts'], written: ['b.ts'], edited: ['c.ts'] },
    });
    expect(ops?.modifiedFiles).toEqual(expect.arrayContaining(['b.ts', 'c.ts']));
    expect(ops?.readFiles).toEqual(['a.ts']);
  });
});
