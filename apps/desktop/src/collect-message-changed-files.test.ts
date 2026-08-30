import { describe, expect, it } from 'vitest';
import type { ToolPresentation } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import {
  collectMessageChangedFiles,
  isWriteLikeToolName,
  matchChangedFileStats,
} from './collect-message-changed-files';

function tool(overrides: Partial<ToolCardUi> & { toolName: string }): ToolCardUi {
  return {
    toolCallId: overrides.toolCallId ?? `tc-${overrides.toolName}`,
    toolName: overrides.toolName,
    status: overrides.status ?? 'done',
    output: overrides.output ?? '',
    ...(overrides.presentation ? { presentation: overrides.presentation } : {}),
    ...(overrides.runId ? { runId: overrides.runId } : {}),
  };
}

function presentation(partial: Partial<ToolPresentation>): ToolPresentation {
  return {
    kind: partial.kind ?? 'filesystem',
    title: partial.title ?? 'tool',
    ...partial,
  };
}

describe('isWriteLikeToolName', () => {
  it('recognizes known write tools', () => {
    expect(isWriteLikeToolName('write')).toBe(true);
    expect(isWriteLikeToolName('edit')).toBe(true);
    expect(isWriteLikeToolName('apply_patch')).toBe(true);
    expect(isWriteLikeToolName('str_replace')).toBe(true);
  });

  it('rejects read tools', () => {
    expect(isWriteLikeToolName('read')).toBe(false);
    expect(isWriteLikeToolName('bash')).toBe(false);
  });
});

describe('collectMessageChangedFiles', () => {
  it('prefers presentation.changedPaths', () => {
    const files = collectMessageChangedFiles([
      tool({
        toolName: 'write',
        presentation: presentation({
          changedPaths: ['src/a.ts'],
          targetPaths: ['src/ignored.ts'],
        }),
      }),
    ]);
    expect(files).toEqual([{ path: 'src/a.ts', name: 'a.ts' }]);
  });

  it('falls back to targetPaths for write-like tools without changedPaths', () => {
    const files = collectMessageChangedFiles([
      tool({
        toolName: 'edit',
        presentation: presentation({ targetPaths: ['packages/foo/bar.ts'] }),
      }),
    ]);
    expect(files).toEqual([{ path: 'packages/foo/bar.ts', name: 'bar.ts' }]);
  });

  it('ignores read tools targetPaths', () => {
    const files = collectMessageChangedFiles([
      tool({
        toolName: 'read',
        presentation: presentation({ targetPaths: ['src/a.ts'] }),
      }),
    ]);
    expect(files).toEqual([]);
  });

  it('dedupes paths across tools', () => {
    const files = collectMessageChangedFiles([
      tool({
        toolCallId: '1',
        toolName: 'write',
        presentation: presentation({ changedPaths: ['src/a.ts'] }),
      }),
      tool({
        toolCallId: '2',
        toolName: 'edit',
        presentation: presentation({ changedPaths: ['src/a.ts', 'src/b.ts'] }),
      }),
    ]);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('skips error tools without host changedPaths', () => {
    const files = collectMessageChangedFiles([
      tool({
        toolName: 'write',
        status: 'error',
        presentation: presentation({ targetPaths: ['src/a.ts'] }),
      }),
    ]);
    expect(files).toEqual([]);
  });

  it('skips error tools even if changedPaths was present on presentation', () => {
    const files = collectMessageChangedFiles([
      tool({
        toolName: 'write',
        status: 'error',
        presentation: presentation({ changedPaths: ['src/a.ts'] }),
      }),
    ]);
    expect(files).toEqual([]);
  });
});

describe('matchChangedFileStats', () => {
  it('sums additions/deletions for matching paths', () => {
    const stats = matchChangedFileStats(
      [
        { path: 'src/a.ts', name: 'a.ts' },
        { path: 'src/b.ts', name: 'b.ts' },
      ],
      [
        { path: 'src/a.ts', additions: 10, deletions: 2 },
        { path: 'src/b.ts', additions: 5, deletions: 1 },
        { path: 'src/other.ts', additions: 99, deletions: 99 },
      ],
    );
    expect(stats.additions).toBe(15);
    expect(stats.deletions).toBe(3);
    expect(stats.matchedPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('matches when one path is a suffix of the other', () => {
    const stats = matchChangedFileStats(
      [{ path: '/abs/repo/src/a.ts', name: 'a.ts' }],
      [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    );
    expect(stats.additions).toBe(3);
    expect(stats.deletions).toBe(1);
  });

  it('does not match unrelated files that share only a basename', () => {
    const stats = matchChangedFileStats(
      [{ path: 'packages/foo/a.ts', name: 'a.ts' }],
      [{ path: 'packages/bar/a.ts', additions: 9, deletions: 1 }],
    );
    expect(stats.additions).toBe(0);
    expect(stats.matchedPaths).toEqual([]);
  });
});
