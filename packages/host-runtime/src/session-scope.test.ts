import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openOrCreateProject } from '@piwin/project';
import { getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { createRemoteProjectId } from './remote-project-id.js';
import { createDefaultArtifactConfig } from '@piwin/contracts';
import {
  resolveGenerationArtifactCapability,
  resolveSessionLocation,
  resolveScopeRefToListIntent,
} from './session-scope.js';

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

  it('rejects combining projectId with a different filesystem path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-id-conflict-'));
    const projectPath = join(rootDir, 'repo');
    const created = await openOrCreateProject(getPiwinProjectsPath(getPiwinRoot(rootDir)), projectPath, {
      displayName: 'repo',
    });
    await expect(
      resolveSessionLocation(
        {
          projectId: createRemoteProjectId(created.path),
          projectPath: join(rootDir, 'other'),
        },
        rootDir,
      ),
    ).rejects.toThrow('projectId cannot be combined with projectPath');
  });

  it('resolves leftover projectId after the path has already been bound', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-project-id-rebind-'));
    const projectPath = join(rootDir, 'repo');
    const created = await openOrCreateProject(getPiwinProjectsPath(getPiwinRoot(rootDir)), projectPath, {
      displayName: 'repo',
    });
    const input = {
      projectId: createRemoteProjectId(created.path),
      sessionName: 'New chat',
    };
    const first = await resolveSessionLocation(input, rootDir);
    const second = await resolveSessionLocation(
      {
        ...input,
        scope: first.scope,
        projectPath: first.workingDirectory,
      },
      rootDir,
    );
    expect(second.scope).toEqual({ kind: 'project', projectPath: created.path });
    expect(second.workingDirectory).toBe(created.path);
  });
});

describe('resolveScopeRefToListIntent', () => {
  it('maps general and all-authorized without touching the project store', async () => {
    await expect(resolveScopeRefToListIntent({ kind: 'general' })).resolves.toEqual({
      scope: { kind: 'general' },
    });
    await expect(resolveScopeRefToListIntent({ kind: 'all-authorized' })).resolves.toEqual({
      allScopes: true,
    });
  });

  it('resolves a Host-issued projectId to the registered path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-scope-ref-'));
    const projectPath = join(rootDir, 'repo');
    const created = await openOrCreateProject(getPiwinProjectsPath(getPiwinRoot(rootDir)), projectPath, {
      displayName: 'repo',
    });
    await expect(
      resolveScopeRefToListIntent(
        { kind: 'project', projectId: createRemoteProjectId(created.path) },
        rootDir,
      ),
    ).resolves.toEqual({ scope: { kind: 'project', projectPath: created.path } });
  });

  it('rejects an unknown projectId', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-scope-ref-unknown-'));
    await expect(
      resolveScopeRefToListIntent(
        { kind: 'project', projectId: 'project-aaaaaaaaaaaaaaaaaaaaaaaa' },
        rootDir,
      ),
    ).rejects.toThrow('Unknown project');
  });
});

describe('resolveGenerationArtifactCapability', () => {
  it('gives Agent sessions Canvas only by default', () => {
    expect(resolveGenerationArtifactCapability(createDefaultArtifactConfig(), 'project', false)).toEqual({
      enabled: true,
      inline: false,
      canvas: true,
    });
  });

  it('gives subagents no Artifact surface even when every switch is on', () => {
    const artifact = {
      ...createDefaultArtifactConfig(),
      scopes: { general: { inline: true, canvas: true }, project: { inline: true, canvas: true } },
    };
    for (const scopeKey of ['general', 'project'] as const) {
      expect(resolveGenerationArtifactCapability(artifact, scopeKey, true)).toMatchObject({
        enabled: false,
        inline: false,
        canvas: false,
      });
    }
  });
});
