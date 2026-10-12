import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readGitBranch, TuiGitBranch } from './tui-git-branch.js';

describe('readGitBranch', () => {
  it('reads the branch of a repo and nothing outside one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'piwin-branch-'));
    try {
      expect(await readGitBranch(dir)).toBeUndefined();
      execFileSync('git', ['init', '-q', '-b', 'feat/x', dir]);
      expect(await readGitBranch(dir)).toBe('feat/x');
      expect(await readGitBranch(path.join(dir, 'missing'))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TuiGitBranch', () => {
  it('tracks the latest cwd and ignores a stale answer', async () => {
    const onChanged = vi.fn();
    let release: ((value: string) => void) | undefined;
    const reads: Record<string, Promise<string | undefined>> = {
      '/slow': new Promise((resolve) => { release = resolve; }),
      '/fast': Promise.resolve('main'),
    };
    const branch = new TuiGitBranch(onChanged, (cwd) => reads[cwd] ?? Promise.resolve(undefined));
    const slow = branch.refresh('/slow');
    await branch.refresh('/fast');
    release?.('old');
    await slow;
    expect(branch.current()).toBe('main');
    await branch.refresh(undefined);
    expect(branch.current()).toBeUndefined();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});
