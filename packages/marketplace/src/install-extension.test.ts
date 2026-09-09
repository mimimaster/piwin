import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { installExtension } from './install-extension.js';

const run = promisify(execFile);

async function makeGitRepo(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'piwin-ext-gitrepo-'));
  await run('git', ['init', '-q'], { cwd: repo });
  await run('git', ['config', 'user.email', 't@t.test'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Test'], { cwd: repo });
  for (const [name, content] of Object.entries(files)) {
    const target = join(repo, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  return repo;
}

describe('installExtension local', () => {
  it('copies a flat .ts extension module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-install-'));
    const srcDir = await mkdtemp(join(tmpdir(), 'piwin-ext-src-'));
    const srcFile = join(srcDir, 'hello.ts');
    await writeFile(srcFile, 'export default function () {}\n', 'utf8');

    const result = await installExtension({
      piwinRoot: root,
      source: { kind: 'local', path: srcFile },
    });
    expect(result.extensionId).toBe('hello');
    expect(result.targetPath).toContain(join(root, 'extensions', 'revisions', 'hello'));
    expect(result.targetPath).toContain(result.contentRevision);
    expect(result.configuredEnabled).toBe(false);
    expect(await readFile(result.targetPath, 'utf8')).toContain('export default');
  });

  it('copies package-style index.ts directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-pkg-'));
    const srcDir = join(await mkdtemp(join(tmpdir(), 'piwin-ext-pkg-src-')), 'mypack');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'index.ts'), 'export default function () {}\n', 'utf8');

    const result = await installExtension({
      piwinRoot: root,
      source: { kind: 'local', path: srcDir },
    });
    expect(result.extensionId).toBe('mypack');
    expect(result.targetPath).toContain(join(root, 'extensions', 'revisions', 'mypack'));
    expect(result.targetPath).toContain(result.contentRevision);
  });
});

describe('installExtension git errors', () => {
  it('explains a missing root entry point without leaking the temp clone path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-giterr-'));
    const repo = await makeGitRepo({ 'README.md': '# no entry point here\n' });

    await expect(
      installExtension({ piwinRoot: root, source: { kind: 'git', url: repo } }),
    ).rejects.toThrow(/no index\.ts entry point/i);

    await expect(
      installExtension({ piwinRoot: root, source: { kind: 'git', url: repo } }),
    ).rejects.not.toThrow(/piwin-extension-git-/);
  });

  it('names the subdirectory when the entry point is missing there', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-giterr-sub-'));
    const repo = await makeGitRepo({
      'extensions/index.ts': 'export default function () {}\n',
      'docs/guide.md': '# docs\n',
    });

    await expect(
      installExtension({
        piwinRoot: root,
        source: { kind: 'git', url: repo, subdir: 'docs' },
      }),
    ).rejects.toThrow(/subdirectory "docs"/i);
  });

  it('installs from a git subdirectory that has an index.ts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-gitsub-'));
    const repo = await makeGitRepo({
      'extensions/index.ts': 'export default function () {}\n',
    });

    const result = await installExtension({
      piwinRoot: root,
      source: { kind: 'git', url: repo, subdir: 'extensions' },
    });
    expect(result.source).toMatchObject({ kind: 'git', subdir: 'extensions' });
    expect(await readFile(join(result.targetPath, 'index.ts'), 'utf8')).toContain('export default');
  });
});
