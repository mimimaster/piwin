import { access, mkdir, mkdtemp } from 'node:fs/promises';
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
});
