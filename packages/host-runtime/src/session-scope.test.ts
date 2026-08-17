import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openOrCreateProject } from '@piwin/project';
import { getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { createRemoteProjectId } from './remote-project-id.js';
import { resolveSessionLocation } from './session-scope.js';

describe('resolveSessionLocation projectId', () => {
  it('binds a remote projectId to the registered project path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-id-'));
    const projectPath = join(rootDir, 'repo');
    const created = await openOrCreateProject(getPiwinProjectsPath(getPiwinRoot(rootDir)), projectPath, {
      displayName: 'repo',
    });
    const location = await resolveSessionLocation(
      { projectId: createRemoteProjectId(created.path), sessionName: 'Mobile session' },
      rootDir,
    );
    expect(location.scope).toEqual({ kind: 'project', projectPath: created.path });
    expect(location.workingDirectory).toBe(created.path);
  });

  it('rejects combining projectId with a filesystem path', async () => {
    await expect(
      resolveSessionLocation({
        projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        projectPath: '/tmp/repo',
      }),
    ).rejects.toThrow('projectId cannot be combined with projectPath');
  });
});
