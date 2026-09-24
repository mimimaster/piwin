/**
 * `preview/resolve-path` end-to-end against a real filesystem (ADR 0052 §6).
 *
 * The golden table owns the spelling matrix; this file proves the command
 * wiring: the same registered-browse-root authority as `project/read-file`, the
 * bounded `find-file` fallback, and the config/media identities — plus the fact
 * that every failure comes back as a payload with attempts instead of a
 * transport error.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentPathResolveData } from '@piwin/contracts';
import { openOrCreateProject } from '@piwin/project';
import { handleDocumentPathCommand } from './document-path-commands.js';
import { getPiwinProjectsPath } from '../paths.js';

const context = {
  requireSession: () => {
    throw new Error('no session in this test');
  },
};

async function resolveIn(
  root: string,
  rawPath: string,
  projectPath?: string,
): Promise<DocumentPathResolveData> {
  const response = await handleDocumentPathCommand(
    {
      type: 'preview/resolve-path',
      input: { rawPath, ...(projectPath ? { projectPath } : {}) },
    },
    'resolve-1',
    { piwinRoot: root, ...context },
  );
  if (!response || !response.success) {
    throw new Error(`resolve-path failed: ${JSON.stringify(response)}`);
  }
  return response.data as DocumentPathResolveData;
}

describe('handleDocumentPathCommand preview/resolve-path', () => {
  it('resolves a workspace file through the registered browse root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-'));
    const project = join(root, 'workspace');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'notes.md'), '# notes\n', 'utf8');

    const data = await resolveIn(root, join(project, 'notes.md'), project);

    expect(data.status).toBe('resolved');
    if (data.status === 'resolved') {
      expect(data.target).toEqual({
        kind: 'project-file',
        relativePath: 'notes.md',
        displayRef: 'notes.md',
      });
    }
  });

  it('places a bare file name with the bounded project search', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-find-'));
    const project = join(root, 'workspace');
    await mkdir(join(project, 'docs', 'design'), { recursive: true });
    await writeFile(join(project, 'docs', 'design', 'shot.png'), 'png', 'utf8');

    const data = await resolveIn(root, 'shot.png', project);

    expect(data.status).toBe('resolved');
    if (data.status === 'resolved') {
      expect(data.target).toMatchObject({
        kind: 'project-file',
        relativePath: 'docs/design/shot.png',
      });
    }
  });

  it('refuses to pick between several matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-amb-'));
    const project = join(root, 'workspace');
    await mkdir(join(project, 'a'), { recursive: true });
    await mkdir(join(project, 'b'), { recursive: true });
    await writeFile(join(project, 'a', 'README.md'), '# a\n', 'utf8');
    await writeFile(join(project, 'b', 'README.md'), '# b\n', 'utf8');

    const data = await resolveIn(root, 'README.md', project);

    expect(data).toMatchObject({ status: 'unresolved', reason: 'ambiguous-file' });
    expect(data.attempts.some((attempt) => attempt.route === 'find-file')).toBe(true);
  });

  it('names a vanished workspace instead of a missing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-gone-'));
    const project = join(root, 'gone-workspace');
    await mkdir(project, { recursive: true });
    await openOrCreateProject(getPiwinProjectsPath(root), project);
    const { rm } = await import('node:fs/promises');
    await rm(project, { recursive: true, force: true });

    const data = await resolveIn(root, join(project, 'notes.md'), project);

    expect(data).toMatchObject({ status: 'unresolved', reason: 'project-root-missing' });
  });

  it('keeps config-store text on the trusted-config channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-cfg-'));
    await writeFile(join(root, 'config.json'), '{"ok":true}\n', 'utf8');

    const data = await resolveIn(root, join(root, 'config.json'));

    expect(data.status).toBe('resolved');
    if (data.status === 'resolved') {
      expect(data.target).toMatchObject({ kind: 'trusted-config', relativePath: 'config.json' });
    }
  });

  it('keeps vault assets on the media channel without touching disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-media-'));
    const asset = join(root, 'media', 'sess-1', 'asset-1.png');

    const data = await resolveIn(root, asset);

    expect(data.status).toBe('resolved');
    if (data.status === 'resolved') {
      expect(data.target).toMatchObject({
        kind: 'media',
        sessionId: 'sess-1',
        assetId: 'asset-1',
      });
    }
  });

  it('answers a missing path with a reason and the routes it tried', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-docpath-miss-'));

    // Outside the config root on purpose: a path *inside* the store is a
    // trusted-config identity, and the read reports the miss instead.
    const data = await resolveIn(root, join(tmpdir(), 'piwin-nowhere', 'missing.md'));

    expect(data.status).toBe('unresolved');
    if (data.status === 'unresolved') {
      expect(data.reason).toBe('not-found');
      expect(data.attempts.map((attempt) => attempt.route)).toEqual([
        'media',
        'skill',
        'project',
        'trusted-config',
        'local-file',
      ]);
      expect(data.attempts[2]?.reason).toBe('no-project-context');
      expect(data.attempts[data.attempts.length - 1]?.reason).toBe('no-such-file');
    }
  });

  it('ignores commands from another family', async () => {
    const response = await handleDocumentPathCommand({ type: 'host/ping' }, 'not-mine', {
      piwinRoot: '/tmp/piwin-unused',
      ...context,
    });
    expect(response).toBeNull();
  });
});
