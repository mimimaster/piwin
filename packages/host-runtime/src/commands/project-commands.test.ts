import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_PREVIEW_CHUNK_BYTES,
  type HostResponse,
  type ProjectRecord,
} from '@piwin/contracts';
import { enrichProjectsWithGitWorkspace, handleProjectCommand } from './project-commands.js';
import { getPiwinGeneralWorkspacePath } from '../paths.js';

const execFileAsync = promisify(execFile);

/** Stored (level 0) RGBA PNG: large on disk, trivially decodable. */
function uncompressedGradientPng(width: number, height: number): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.byteLength);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      rows.set([x % 256, y % 256, 128, 255], row + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('project commands', () => {
  it('removes a remembered project without deleting its project directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-command-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath);

    const opened = await handleProjectCommand(
      { type: 'project/open', path: projectPath },
      'open-request',
      rootDir,
    );
    expect(opened?.success).toBe(true);

    const removed = await handleProjectCommand(
      { type: 'project/remove', path: projectPath },
      'remove-request',
      rootDir,
    );
    expect(removed).toMatchObject({
      id: 'remove-request',
      type: 'response',
      command: 'project/remove',
      success: true,
      data: { path: projectPath, removed: true },
    });

    const listed = await handleProjectCommand({ type: 'project/list' }, 'list-request', rootDir);
    expect(listed).toMatchObject({
      success: true,
      data: { projects: [] },
    });
    await expect(access(projectPath)).resolves.toBeUndefined();
  });

  it('splits image previews that would overflow one Host wire frame into ranged slices', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-image-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath);
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const small = Buffer.concat([pngSignature, Buffer.alloc(80 * 1024, 1)]);
    const large = Buffer.concat([
      pngSignature,
      Buffer.from(Array.from({ length: 1_400_000 }, (_, index) => (index * 31) % 256)),
    ]);
    await writeFile(join(projectPath, 'small.png'), small);
    await writeFile(join(projectPath, 'icon_white.png'), large);
    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);
    const wireBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
    const dataOf = (response: HostResponse | null): unknown =>
      response?.success ? response.data : undefined;

    const inline = await handleProjectCommand(
      { type: 'project/read-file', projectPath, relativePath: 'small.png' },
      'small',
      rootDir,
    );
    expect(dataOf(inline)).toMatchObject({
      previewDataUrl: `data:image/png;base64,${small.toString('base64')}`,
    });

    const head = await handleProjectCommand(
      { type: 'project/read-file', projectPath, relativePath: 'icon_white.png' },
      'large',
      rootDir,
    );
    const headData = dataOf(head) as { previewDataUrl?: string; previewChunkBytes?: number };
    expect(head?.success).toBe(true);
    expect(headData.previewDataUrl).toBeUndefined();
    expect(headData.previewChunkBytes).toBe(PROJECT_PREVIEW_CHUNK_BYTES);

    const parts: string[] = [];
    for (let offset = 0; offset < large.byteLength; offset += PROJECT_PREVIEW_CHUNK_BYTES) {
      const slice = await handleProjectCommand(
        {
          type: 'project/read-file',
          projectPath,
          relativePath: 'icon_white.png',
          previewRange: { offset, length: PROJECT_PREVIEW_CHUNK_BYTES },
        },
        `slice-${offset}`,
        rootDir,
      );
      expect(wireBytes(slice)).toBeLessThan(1_000_000);
      const chunk = (dataOf(slice) as { previewChunk?: { offset: number; base64Data: string } })
        .previewChunk;
      expect(chunk?.offset).toBe(offset);
      parts.push(chunk?.base64Data ?? '');
    }
    expect(parts.join('')).toBe(large.toString('base64'));

    const outOfRange = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath,
        relativePath: 'icon_white.png',
        previewRange: { offset: large.byteLength, length: 10 },
      },
      'bad-range',
      rootDir,
    );
    expect(outOfRange?.success).toBe(false);
  });

  it('sends a decodable WebP placeholder with a ranged image preview', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-thumb-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath);
    await writeFile(join(projectPath, 'gradient.png'), uncompressedGradientPng(900, 900));
    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);

    const read = await handleProjectCommand(
      { type: 'project/read-file', projectPath, relativePath: 'gradient.png' },
      'thumb',
      rootDir,
    );
    const data = (read?.success ? read.data : undefined) as {
      previewChunkBytes?: number;
      previewThumbDataUrl?: string;
    };
    expect(data.previewChunkBytes).toBe(PROJECT_PREVIEW_CHUNK_BYTES);
    expect(data.previewThumbDataUrl).toMatch(/^data:image\/webp;base64,UklGR/);
    expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThan(1_000_000);
  });

  it('reads a text file under a registered project root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-ok-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(join(projectPath, 'docs'), { recursive: true });
    await writeFile(join(projectPath, 'docs', 'foo.md'), '# Foo\n\nhello\n', 'utf8');

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);

    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath,
        relativePath: 'docs/foo.md',
      },
      'read-ok',
      rootDir,
    );
    expect(read?.success).toBe(true);
    expect(read && 'data' in read ? read.data : null).toMatchObject({
      relativePath: 'docs/foo.md',
      content: '# Foo\n\nhello\n',
      isBinary: false,
    });
  });

  it('returns a data-URL preview for PNG files under a registered project', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-png-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(join(projectPath, 'docs', 'design'), { recursive: true });
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    await writeFile(join(projectPath, 'docs', 'design', 'icon.png'), pngBytes);

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);

    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath,
        relativePath: 'docs/design/icon.png',
      },
      'read-png',
      rootDir,
    );
    expect(read?.success).toBe(true);
    const data = read && 'data' in read ? read.data : null;
    expect(data).toMatchObject({
      relativePath: 'docs/design/icon.png',
      isBinary: true,
      mimeHint: 'image/png',
      content: '',
    });
    expect(data && typeof data === 'object' && 'previewDataUrl' in data ? data.previewDataUrl : null)
      .toMatch(/^data:image\/png;base64,/);
  });

  it('rejects project/read-file for an unregistered root such as /etc', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-etc-'));
    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath: '/etc',
        relativePath: 'passwd',
      },
      'read-etc',
      rootDir,
    );
    expect(read).toMatchObject({
      success: false,
      command: 'project/read-file',
      error: 'project-root-not-registered',
    });
  });

  it('rejects project/read-file for a temporary unregistered directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-tmp-'));
    const orphan = await mkdtemp(join(tmpdir(), 'piwin-orphan-proj-'));
    await writeFile(join(orphan, 'secret.md'), 'nope\n', 'utf8');

    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath: orphan,
        relativePath: 'secret.md',
      },
      'read-orphan',
      rootDir,
    );
    expect(read).toMatchObject({
      success: false,
      error: 'project-root-not-registered',
    });
  });

  it('lists and reads through a realpath alias of a registered symlink root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-alias-'));
    const realProject = join(rootDir, 'workspace');
    await mkdir(join(realProject, 'docs'), { recursive: true });
    await writeFile(join(realProject, 'docs', 'scheme.md'), '# scheme\n', 'utf8');
    const aliasParent = await mkdtemp(join(tmpdir(), 'piwin-project-alias-link-'));
    const aliasProject = join(aliasParent, 'proj-link');
    await symlink(realProject, aliasProject);

    await handleProjectCommand({ type: 'project/open', path: aliasProject }, 'open-alias', rootDir);

    const listed = await handleProjectCommand(
      { type: 'project/list-dir', projectPath: realProject },
      'list-real',
      rootDir,
    );
    expect(listed?.success).toBe(true);
    expect(listed && 'data' in listed ? listed.data : null).toMatchObject({
      entries: [{ name: 'docs', relativePath: 'docs', kind: 'directory' }],
    });

    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath: realProject,
        relativePath: 'docs/scheme.md',
      },
      'read-real',
      rootDir,
    );
    expect(read?.success).toBe(true);
    expect(read && 'data' in read ? read.data : null).toMatchObject({
      relativePath: 'docs/scheme.md',
      content: '# scheme\n',
    });
  });

  it('rejects a project-local symlink that realpaths outside the root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-read-link-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    const outsideDir = await mkdtemp(join(tmpdir(), 'piwin-outside-secret-'));
    const outsideFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'leak\n', 'utf8');
    await symlink(outsideFile, join(projectPath, 'escape.txt'));

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);

    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath,
        relativePath: 'escape.txt',
      },
      'read-escape',
      rootDir,
    );
    expect(read).toMatchObject({
      success: false,
      error: 'path escapes project root via symlink',
    });
  });

  it('lists a directory when projectPath is the Host-issued projectId', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-listdir-id-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(join(projectPath, 'src'), { recursive: true });
    await writeFile(join(projectPath, 'src', 'main.ts'), 'export {}\n', 'utf8');

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open', rootDir);
    const { createRemoteProjectId } = await import('../remote-project-id.js');
    const projectId = createRemoteProjectId(projectPath);

    const listed = await handleProjectCommand(
      { type: 'project/list-dir', projectPath: projectId, relativePath: 'src' },
      'list-id',
      rootDir,
    );
    expect(listed?.success).toBe(true);
    expect(listed && 'data' in listed ? listed.data : null).toMatchObject({
      relativePath: 'src',
      entries: [{ name: 'main.ts', relativePath: 'src/main.ts', kind: 'file' }],
    });
  });

  it('rejects an unknown projectId for list-dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-listdir-unknown-'));
    const listed = await handleProjectCommand(
      {
        type: 'project/list-dir',
        projectPath: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        relativePath: '',
      },
      'list-unknown',
      rootDir,
    );
    expect(listed).toMatchObject({
      success: false,
      error: 'unknown-project',
    });
  });

  it('lists and reads the General workspace without registering it as a project', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-general-browse-'));
    const generalWorkspace = getPiwinGeneralWorkspacePath(rootDir);
    await mkdir(generalWorkspace, { recursive: true });
    await writeFile(join(generalWorkspace, 'card.html'), '<h1>Hello</h1>\n', 'utf8');

    const listed = await handleProjectCommand(
      { type: 'project/list-dir', projectPath: generalWorkspace },
      'list-general',
      rootDir,
    );
    expect(listed?.success).toBe(true);
    expect(listed && 'data' in listed ? listed.data : null).toMatchObject({
      projectPath: generalWorkspace,
      entries: [{ name: 'card.html', relativePath: 'card.html', kind: 'file' }],
    });

    const read = await handleProjectCommand(
      {
        type: 'project/read-file',
        projectPath: generalWorkspace,
        relativePath: 'card.html',
      },
      'read-general',
      rootDir,
    );
    expect(read?.success).toBe(true);
    expect(read && 'data' in read ? read.data : null).toMatchObject({
      relativePath: 'card.html',
      content: '<h1>Hello</h1>\n',
      isBinary: false,
    });
  });

  it('inherits trust when opening a worktree of a trusted repository', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-trust-inherit-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
    await execFileAsync('git', ['branch', 'feat/x'], { cwd: projectPath });
    const linkedPath = join(rootDir, 'linked');
    await execFileAsync('git', ['worktree', 'add', linkedPath, 'feat/x'], { cwd: projectPath });

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open-main', rootDir);
    await handleProjectCommand(
      { type: 'project/trust', path: projectPath },
      'trust-main',
      rootDir,
    );

    const opened = await handleProjectCommand(
      { type: 'project/open', path: linkedPath },
      'open-linked',
      rootDir,
    );
    expect(opened?.success).toBe(true);
    expect(opened && 'data' in opened ? opened.data : null).toMatchObject({
      trusted: true,
      trust: 'trusted',
    });
  });

  it('does not inherit trust from a different repository', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-trust-foreign-'));
    const trustedPath = join(rootDir, 'trusted');
    const foreignPath = join(rootDir, 'foreign');
    await mkdir(trustedPath, { recursive: true });
    await mkdir(foreignPath, { recursive: true });
    for (const repoPath of [trustedPath, foreignPath]) {
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoPath });
      await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
        cwd: repoPath,
      });
      await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: repoPath });
      await writeFile(join(repoPath, 'README.md'), 'hello\n', 'utf8');
      await execFileAsync('git', ['add', 'README.md'], { cwd: repoPath });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });
    }

    await handleProjectCommand({ type: 'project/open', path: trustedPath }, 'open-trusted', rootDir);
    await handleProjectCommand(
      { type: 'project/trust', path: trustedPath },
      'trust-trusted',
      rootDir,
    );

    const opened = await handleProjectCommand(
      { type: 'project/open', path: foreignPath },
      'open-foreign',
      rootDir,
    );
    expect(opened?.success).toBe(true);
    expect(opened && 'data' in opened ? opened.data : null).toMatchObject({
      trusted: false,
      trust: 'untrusted',
    });
  });

  it('enriches project/list with a shared gitRepositoryId for linked worktrees', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-list-git-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
    await execFileAsync('git', ['branch', 'feat/x'], { cwd: projectPath });
    const linkedPath = join(rootDir, 'linked');
    await execFileAsync('git', ['worktree', 'add', linkedPath, 'feat/x'], { cwd: projectPath });

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open-main', rootDir);
    await handleProjectCommand({ type: 'project/open', path: linkedPath }, 'open-linked', rootDir);

    const listed = await handleProjectCommand({ type: 'project/list' }, 'list-git', rootDir);
    expect(listed?.success).toBe(true);
    const projects =
      listed && 'data' in listed
        ? ((listed.data as { projects: ProjectRecord[] }).projects ?? [])
        : [];
    const main = projects.find((item) => item.path === projectPath);
    const linked = projects.find((item) => item.path === linkedPath);
    expect(main?.currentBranch).toBe('main');
    expect(main?.isPrimaryWorktree).toBe(true);
    expect(linked?.currentBranch).toBe('feat/x');
    expect(linked?.isPrimaryWorktree).toBe(false);
    expect(linked?.gitRepositoryId).toBe(main?.gitRepositoryId);
    expect(main?.gitRepositoryId).toMatch(/^[a-f0-9]{16}$/);
    expect(await realpath(main?.gitRootPath ?? '')).toBe(await realpath(projectPath));
    expect(await realpath(linked?.gitRootPath ?? '')).toBe(await realpath(linkedPath));
  });

  it('reuses a registered checkout instead of remembering a subdirectory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-open-nested-'));
    const projectPath = join(rootDir, 'workspace');
    const nestedPath = join(projectPath, 'apps');
    await mkdir(nestedPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open-root', rootDir);
    const nestedOpen = await handleProjectCommand(
      { type: 'project/open', path: nestedPath },
      'open-nested',
      rootDir,
    );
    expect(nestedOpen?.success).toBe(true);
    expect(nestedOpen && 'data' in nestedOpen ? nestedOpen.data : null).toMatchObject({
      path: projectPath,
    });

    const listed = await handleProjectCommand({ type: 'project/list' }, 'list-nested', rootDir);
    const projects =
      listed && 'data' in listed
        ? ((listed.data as { projects: ProjectRecord[] }).projects ?? [])
        : [];
    expect(projects.map((project) => project.path)).toEqual([projectPath]);
  });

  it('remembers the git checkout root when the first open is a subdirectory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-open-lift-'));
    const projectPath = join(rootDir, 'workspace');
    const nestedPath = join(projectPath, 'apps');
    await mkdir(nestedPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });

    const nestedOpen = await handleProjectCommand(
      { type: 'project/open', path: nestedPath },
      'open-nested-first',
      rootDir,
    );
    const openedPath =
      nestedOpen && 'data' in nestedOpen
        ? ((nestedOpen.data as { path?: string }).path ?? '')
        : '';
    expect(await realpath(openedPath)).toBe(await realpath(projectPath));

    const listed = await handleProjectCommand({ type: 'project/list' }, 'list-lifted', rootDir);
    const projects =
      listed && 'data' in listed
        ? ((listed.data as { projects: ProjectRecord[] }).projects ?? [])
        : [];
    expect(projects).toHaveLength(1);
    expect(await realpath(projects[0]?.path ?? '')).toBe(await realpath(projectPath));
  });

  it('still remembers a linked worktree as its own project', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-open-wt-'));
    const projectPath = join(rootDir, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
    await execFileAsync('git', ['config', 'user.email', 'piwin-test@example.com'], {
      cwd: projectPath,
    });
    await execFileAsync('git', ['config', 'user.name', 'piwin test'], { cwd: projectPath });
    await writeFile(join(projectPath, 'README.md'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
    await execFileAsync('git', ['branch', 'feat/x'], { cwd: projectPath });
    const linkedPath = join(rootDir, 'linked');
    await execFileAsync('git', ['worktree', 'add', linkedPath, 'feat/x'], { cwd: projectPath });

    await handleProjectCommand({ type: 'project/open', path: projectPath }, 'open-main', rootDir);
    const linkedOpen = await handleProjectCommand(
      { type: 'project/open', path: linkedPath },
      'open-linked',
      rootDir,
    );
    expect(linkedOpen && 'data' in linkedOpen ? linkedOpen.data : null).toMatchObject({
      path: linkedPath,
    });
  });

  it('lists a project whose git probe misses the budget without enrichment', async () => {
    const fast: ProjectRecord = { path: '/repo/fast', trust: 'trusted' } as ProjectRecord;
    const blocked: ProjectRecord = { path: '/Volumes/Disk/blocked', trust: 'trusted' } as ProjectRecord;
    const listed = await enrichProjectsWithGitWorkspace([blocked, fast], {
      budgetMs: 20,
      readListing: (projectPath) =>
        projectPath === fast.path
          ? Promise.resolve({
              gitRepositoryId: 'abcdef0123456789',
              isPrimaryWorktree: true,
              currentBranch: 'main',
              gitRootPath: fast.path,
            })
          : new Promise(() => {}),
    });
    expect(listed.gitWorkspacePending).toBe(true);
    expect(listed.projects).toEqual([
      blocked,
      { ...fast, gitRepositoryId: 'abcdef0123456789', isPrimaryWorktree: true, currentBranch: 'main', gitRootPath: fast.path },
    ]);
  });

  it('omits gitWorkspacePending when every probe settles, including failures', async () => {
    const project: ProjectRecord = { path: '/repo/broken', trust: 'trusted' } as ProjectRecord;
    const listed = await enrichProjectsWithGitWorkspace([project], {
      budgetMs: 1_000,
      readListing: () => Promise.reject(new Error('spawn git ENOENT')),
    });
    expect(listed).toEqual({ projects: [project] });
  });
});
