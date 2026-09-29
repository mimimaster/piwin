import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  captureWorkspaceFingerprint,
  diffWorkspaceFingerprints,
  parsePorcelainZPaths,
  resetWorkspaceFingerprintCooldownsForTests,
} from './workspace-fingerprint.js';

describe('parsePorcelainZPaths', () => {
  it('reads modified, untracked and both sides of a rename', () => {
    const stdout = [' M src/a.ts', '?? new file.txt', 'R  to.ts', 'from.ts', ''].join('\0');
    expect(parsePorcelainZPaths(stdout)).toEqual(['src/a.ts', 'new file.txt', 'to.ts', 'from.ts']);
  });
});

describe('diffWorkspaceFingerprints', () => {
  it('reports new, restamped and cleaned paths', () => {
    const before = new Map([
      ['a', '1:1'],
      ['b', '1:1'],
    ]);
    const after = new Map([
      ['a', '1:1'],
      ['b', '2:2'],
      ['c', '1:1'],
    ]);
    expect(diffWorkspaceFingerprints(before, after)).toEqual(['b', 'c']);
    expect(diffWorkspaceFingerprints(after, before)).toEqual(['b', 'c']);
  });
});

describe('captureWorkspaceFingerprint', () => {
  let root: string;

  beforeEach(async () => {
    resetWorkspaceFingerprintCooldownsForTests();
    root = await mkdtemp(join(tmpdir(), 'piwin-fingerprint-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns null outside a git work tree', async () => {
    expect(await captureWorkspaceFingerprint(root)).toBeNull();
  });

  it('sees an edit to an already-dirty file inside a subdirectory session', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    await mkdir(join(root, 'pkg'));
    await writeFile(join(root, 'pkg', 'x.ts'), 'one');
    const session = join(root, 'pkg');
    const before = await captureWorkspaceFingerprint(session);
    await writeFile(join(root, 'pkg', 'x.ts'), 'one two');
    await writeFile(join(root, 'outside.ts'), 'not in the session subtree');
    const after = await captureWorkspaceFingerprint(session);
    if (before === null || after === null) throw new Error('expected fingerprints');
    expect(diffWorkspaceFingerprints(before, after)).toEqual(['pkg/x.ts']);
  });
});
