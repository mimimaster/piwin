import { describe, expect, it } from 'vitest';
import {
  fileNameFromDetail,
  formatWorkDuration,
  resolveWorkFoldCode,
} from './work-fold-header.js';

describe('formatWorkDuration', () => {
  it('matches proto-01 done copy', () => {
    expect(formatWorkDuration(41_000, 'zh-CN')).toBe('已工作 41s');
    expect(formatWorkDuration(94_000, 'zh-CN')).toBe('已工作 1m 34s');
  });
});

describe('fileNameFromDetail', () => {
  it('takes the basename of a path', () => {
    expect(fileNameFromDetail('apps/desktop/src/composer-run-actions.tsx')).toBe(
      'composer-run-actions.tsx',
    );
  });

  it('returns a bare filename unchanged', () => {
    expect(fileNameFromDetail('composer-run-actions.tsx')).toBe('composer-run-actions.tsx');
  });
});

describe('resolveWorkFoldCode', () => {
  it('prefers a shell command', () => {
    expect(
      resolveWorkFoldCode({
        presentation: { command: 'pnpm typecheck', targetPaths: ['unused.ts'] },
      }),
    ).toBe('pnpm typecheck');
  });

  it('falls back to the write target basename', () => {
    expect(
      resolveWorkFoldCode({
        presentation: { changedPaths: ['apps/desktop/src/composer-run-actions.tsx'] },
      }),
    ).toBe('composer-run-actions.tsx');
  });
});
