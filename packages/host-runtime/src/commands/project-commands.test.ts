import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '@piwin/contracts';
import { handleProjectCommand } from './project-commands.js';
import { getPiwinGeneralWorkspacePath } from '../paths.js';

const execFileAsync = promisify(execFile);

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
  });
});
