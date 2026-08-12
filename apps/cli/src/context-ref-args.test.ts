import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildCliContextRefs,
  collectRefArgs,
  resolveCliRef,
} from './context-ref-args.js';

describe('collectRefArgs', () => {
  it('collects repeatable --ref values and skips flag consumers', () => {
    const argv = [
      'hello',
      '--ref',
      'src/a.ts',
      '--project',
      '/p',
      '--ref',
      'docs',
      '--mock',
    ];
    expect(collectRefArgs(argv)).toEqual(['src/a.ts', 'docs']);
  });

  it('ignores a trailing --ref without value', () => {
    expect(collectRefArgs(['--ref'])).toEqual([]);
  });
});

describe('resolveCliRef', () => {
  it('maps a project-relative file to a file ref', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-ref-'));
    await writeFile(path.join(root, 'a.ts'), 'export const x = 1;');
    const result = await resolveCliRef(root, 'a.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref).toMatchObject({
        kind: 'file',
        relativePath: 'a.ts',
        label: 'a.ts',
      });
    }
  });

  it('maps a directory ref to a folder ref', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-ref-'));
    await mkdir(path.join(root, 'docs'));
    const result = await resolveCliRef(root, 'docs');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref).toMatchObject({
        kind: 'folder',
        relativePath: 'docs',
      });
    }
  });

  it('rejects absolute paths outside the project root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-ref-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-ref-outside-'));
    const result = await resolveCliRef(root, outside);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('outside project root');
    }
  });

  it('rejects without a project path', async () => {
    const result = await resolveCliRef(undefined, 'a.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('--project');
    }
  });

  it('rejects missing paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-ref-'));
    const result = await resolveCliRef(root, 'missing.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('does not exist');
    }
  });

  it('buildContextCliRefs fails fast on the first bad ref', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cm-cli-ref-'));
    await writeFile(path.join(root, 'a.ts'), 'x');
    const result = await buildCliContextRefs(root, ['a.ts', 'nope.ts']);
    expect(result.ok).toBe(false);
  });
});
