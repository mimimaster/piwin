import { describe, expect, it } from 'vitest';
import { mapTargetToContextRef, mapTargetToFlashcardContextRef } from './map-to-ref.js';
import type { ContextMenuTarget } from './types.js';

describe('mapTargetToContextRef', () => {
  it('maps file-tree-file to file ref', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '/p',
      relativePath: 'src/a.ts',
      absolutePath: '/p/src/a.ts',
      label: 'a.ts',
    };
    expect(mapTargetToContextRef(target)).toMatchObject({
      kind: 'file',
      relativePath: 'src/a.ts',
    });
  });

  it('maps folder to folder ref', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-folder',
      projectPath: '/p',
      relativePath: 'src',
      absolutePath: '/p/src',
      label: 'src',
    };
    expect(mapTargetToContextRef(target)).toEqual({
      kind: 'folder',
      projectPath: '/p',
      relativePath: 'src',
      label: 'src',
    });
  });

  it('prefers file ref when selection has path and lines', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      projectPath: '/p',
      relativePath: 'a.ts',
      lineStart: 1,
      lineEnd: 3,
      selectedText: 'code',
      label: 'a.ts:1-3',
    };
    expect(mapTargetToContextRef(target)).toMatchObject({
      kind: 'file',
      lineStart: 1,
      lineEnd: 3,
    });
  });

  it('uses selection kind without path', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'plain',
      label: 'sel',
    };
    expect(mapTargetToContextRef(target)).toMatchObject({
      kind: 'selection',
      snapshotText: 'plain',
    });
  });

  it('maps a transcript selection without path to a bounded selection ref', () => {
    const selectedText = `${'n'.repeat(8010)}`;
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText,
      label: 'n…',
    };
    expect(mapTargetToContextRef(target)).toEqual({
      kind: 'selection',
      snapshotText: selectedText.slice(0, 8000),
      label: 'n…',
    });
  });

  it('flashcard mapping keeps snapshotText for document selections with path+lines', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      projectPath: '/repo',
      relativePath: 'docs/react.md',
      lineStart: 12,
      lineEnd: 12,
      selectedText: '依赖数组',
      label: 'react.md:12',
    };
    expect(mapTargetToContextRef(target)).toMatchObject({ kind: 'file' });
    expect(mapTargetToFlashcardContextRef(target)).toEqual({
      kind: 'selection',
      snapshotText: '依赖数组',
      projectPath: '/repo',
      relativePath: 'docs/react.md',
      lineStart: 12,
      lineEnd: 12,
      label: 'react.md:12',
    });
  });
});
