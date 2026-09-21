import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openOrCreateProject } from '@piwin/project';
import { getPiwinGeneralWorkspacePath, getPiwinProjectsPath } from './paths.js';
import { listTrustedProjectRoots } from './trusted-project-roots.js';

describe('listTrustedProjectRoots', () => {
  it('always trusts the built-in No Repo workspace', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-roots-'));
    await expect(listTrustedProjectRoots(rootDir)).resolves.toEqual([
      getPiwinGeneralWorkspacePath(rootDir),
    ]);
  });

  it('adds trusted projects and skips untrusted ones', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-roots-store-'));
    const storePath = getPiwinProjectsPath(rootDir);
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-project-'));
    const untrustedDir = await mkdtemp(join(tmpdir(), 'piwin-untrusted-project-'));
    await openOrCreateProject(storePath, trustedDir, { trust: 'trusted' });
    await openOrCreateProject(storePath, untrustedDir, { trust: 'untrusted' });

    const roots = await listTrustedProjectRoots(rootDir);
    expect(roots[0]).toBe(getPiwinGeneralWorkspacePath(rootDir));
    expect(roots).toContain(trustedDir);
    expect(roots).not.toContain(untrustedDir);
  });
});
