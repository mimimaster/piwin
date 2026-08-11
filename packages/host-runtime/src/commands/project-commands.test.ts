import { access, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleProjectCommand } from './project-commands.js';

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
});
