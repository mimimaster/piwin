import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalFsPath, isPathInsideRoot, resolveTrustedCwd } from './cwd-policy.js';

describe('cwd policy', () => {
  it('accepts cwd equal to trusted root', () => {
    const result = resolveTrustedCwd('/tmp/proj', ['/tmp/proj']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absoluteCwd).toBe(result.projectRoot);
    }
  });

  it('accepts cwd under trusted root', () => {
    const result = resolveTrustedCwd('/tmp/proj/apps', ['/tmp/proj']);
    expect(result.ok).toBe(true);
  });

  it('rejects cwd outside trusted roots', () => {
    const result = resolveTrustedCwd('/tmp/other', ['/tmp/proj']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/outside trusted/);
    }
  });

  it('rejects path escape via ..', () => {
    expect(isPathInsideRoot('/tmp/proj/../evil', '/tmp/proj')).toBe(false);
  });

  it('rejects empty trusted list', () => {
    const result = resolveTrustedCwd('/tmp/proj', []);
    expect(result.ok).toBe(false);
  });

  it('trusts a cwd spelled through the real path of a project registered via a symlink', () => {
    // Real case: project registered as /Volumes/…/piwin → ~/Developer/piwin,
    // agent working in ~/Developer/piwin/.worktrees/<branch>.
    const base = mkdtempSync(join(tmpdir(), 'piwin-cwd-policy-'));
    try {
      const realProject = join(base, 'Developer', 'piwin');
      const worktree = join(realProject, '.worktrees', 'feature');
      mkdirSync(worktree, { recursive: true });
      const registered = join(base, 'Volumes', 'piwin');
      mkdirSync(join(base, 'Volumes'), { recursive: true });
      symlinkSync(realProject, registered);

      const result = resolveTrustedCwd(worktree, [registered]);
      expect(result).toMatchObject({ ok: true, absoluteCwd: worktree, projectRoot: registered });

      // A sibling of the real project is still outside.
      const sibling = join(base, 'Developer', 'other');
      mkdirSync(sibling, { recursive: true });
      expect(resolveTrustedCwd(sibling, [registered]).ok).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a cwd under a trusted root when a symlink points outside it', () => {
    const base = mkdtempSync(join(tmpdir(), 'piwin-cwd-escape-'));
    try {
      const project = join(base, 'project');
      const outside = join(base, 'outside');
      mkdirSync(project);
      mkdirSync(outside);
      symlinkSync(outside, join(project, 'external'));

      expect(resolveTrustedCwd(join(project, 'external'), [project]).ok).toBe(false);
      expect(resolveTrustedCwd(join(project, 'external', 'new-dir'), [project]).ok).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('canonicalizes a path that does not exist yet through its nearest real ancestor', () => {
    const base = mkdtempSync(join(tmpdir(), 'piwin-canonical-'));
    try {
      const real = join(base, 'real');
      mkdirSync(real, { recursive: true });
      const link = join(base, 'link');
      symlinkSync(real, link);
      const realBase = canonicalFsPath(base);
      expect(canonicalFsPath(join(link, 'new', 'file.txt'))).toBe(join(realBase, 'real', 'new', 'file.txt'));
      expect(canonicalFsPath(link)).toBe(join(realBase, 'real'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
