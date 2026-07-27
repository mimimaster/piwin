import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionIndexDocument, SessionIndexRecord } from '@piwin/contracts';
import {
  archiveSessionRecord,
  createSessionRecord,
  deleteSessionRecord,
  listSessionsForProject,
  loadSessionIndex,
  pinSessionRecord,
  renameSessionRecord,
  saveSessionIndex,
  unarchiveSessionRecord,
  unpinSessionRecord,
  upsertSessionRecord,
  listAllSessionRecords,
} from './session-index-store.js';

describe('session-index-store', () => {
  it('upserts and lists by project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-session-'));
    const filePath = join(dir, 'index.json');
    const record = createSessionRecord({
      id: 's1',
      projectPath: '/tmp/proj',
      name: 'demo',
    });
    await upsertSessionRecord(filePath, record);
    const listed = await listSessionsForProject(filePath, '/tmp/proj');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('demo');
  });

  it('pins sessions and sorts pinned first across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-session-pin-'));
    const filePath = join(dir, 'index.json');
    const older = createSessionRecord({ id: 's-old', projectPath: '/tmp/proj', name: 'older' });
    older.updatedAt = '2026-07-20T10:00:00.000Z';
    const newer = createSessionRecord({ id: 's-new', projectPath: '/tmp/proj', name: 'newer' });
    newer.updatedAt = '2026-07-21T10:00:00.000Z';
    await upsertSessionRecord(filePath, older);
    await upsertSessionRecord(filePath, newer);

    await pinSessionRecord(filePath, 's-old');
    const listed = await listSessionsForProject(filePath, '/tmp/proj');
    expect(listed.map((item) => item.id)).toEqual(['s-old', 's-new']);
    expect(listed[0]?.isPinned).toBe(true);
    expect(listed[0]?.pinnedAt).toBeTruthy();

    await unpinSessionRecord(filePath, 's-old');
    const unpinned = await listSessionsForProject(filePath, '/tmp/proj');
    expect(unpinned[0]?.id).toBe('s-new');
    expect(unpinned.find((item) => item.id === 's-old')?.isPinned).toBe(false);
  });

  it('renames, archives (hides from default list), restores, and deletes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-session-archive-'));
    const filePath = join(dir, 'index.json');
    await upsertSessionRecord(
      filePath,
      createSessionRecord({ id: 's1', projectPath: '/tmp/proj', name: 'alpha' }),
    );
    await upsertSessionRecord(
      filePath,
      createSessionRecord({ id: 's2', projectPath: '/tmp/proj', name: 'beta' }),
    );

    const renamed = await renameSessionRecord(filePath, 's1', '  Alpha Renamed  ');
    expect(renamed?.name).toBe('Alpha Renamed');

    await pinSessionRecord(filePath, 's1');
    const archived = await archiveSessionRecord(filePath, 's1');
    expect(archived?.isArchived).toBe(true);
    expect(archived?.isPinned).toBe(false);
    expect(archived?.archivedAt).toBeTruthy();

    const activeOnly = await listSessionsForProject(filePath, '/tmp/proj');
    expect(activeOnly.map((item) => item.id)).toEqual(['s2']);

    const withArchived = await listSessionsForProject(filePath, '/tmp/proj', {
      includeArchived: true,
    });
    expect(withArchived.map((item) => item.id).sort()).toEqual(['s1', 's2']);

    await unarchiveSessionRecord(filePath, 's1');
    const restored = await listSessionsForProject(filePath, '/tmp/proj');
    expect(restored.map((item) => item.id).sort()).toEqual(['s1', 's2']);

    await archiveSessionRecord(filePath, 's1');
    const deleted = await deleteSessionRecord(filePath, 's1');
    expect(deleted?.id).toBe('s1');
    const afterDelete = await listSessionsForProject(filePath, '/tmp/proj', {
      includeArchived: true,
    });
    expect(afterDelete.map((item) => item.id)).toEqual(['s2']);
  });

  it('rejects empty rename names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-session-rename-'));
    const filePath = join(dir, 'index.json');
    await upsertSessionRecord(
      filePath,
      createSessionRecord({ id: 's1', projectPath: '/tmp/proj', name: 'keep' }),
    );
    const result = await renameSessionRecord(filePath, 's1', '   ');
    expect(result).toBeUndefined();
    const listed = await listSessionsForProject(filePath, '/tmp/proj');
    expect(listed[0]?.name).toBe('keep');
  });

  describe('v1→v2 migration', () => {
    it('loads a v1 document and normalizes every record to v2', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-migration-'));
      const filePath = join(dir, 'index.json');

      // Write a v1 document (no scope field)
      const v1Doc: SessionIndexDocument = {
        version: 1,
        sessions: [
          {
            id: 's1',
            projectPath: '/tmp/proj-a',
            createdAt: '2026-07-20T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z',
            messageCount: 0,
          },
          {
            id: 's2',
            projectPath: '/tmp/proj-b',
            createdAt: '2026-07-21T10:00:00.000Z',
            updatedAt: '2026-07-21T10:00:00.000Z',
            messageCount: 0,
            name: 'test-session',
          },
        ],
      };
      await writeFile(filePath, JSON.stringify(v1Doc, null, 2));

      const loaded = await loadSessionIndex(filePath);
      expect(loaded.version).toBe(2);

      // V1 records should have scope normalized
      expect(loaded.sessions[0]?.scope).toEqual({
        kind: 'project',
        projectPath: '/tmp/proj-a',
      });
      expect(loaded.sessions[0]?.workingDirectory).toBe('/tmp/proj-a');

      expect(loaded.sessions[1]?.scope).toEqual({
        kind: 'project',
        projectPath: '/tmp/proj-b',
      });
      expect(loaded.sessions[1]?.workingDirectory).toBe('/tmp/proj-b');
      expect(loaded.sessions[1]?.name).toBe('test-session');
    });

    it('writes version 2 on first mutation after loading v1', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-mutation-'));
      const filePath = join(dir, 'index.json');

      // Write a v1 document
      const v1Doc: SessionIndexDocument = {
        version: 1,
        sessions: [
          {
            id: 's1',
            projectPath: '/tmp/proj',
            createdAt: '2026-07-20T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z',
            messageCount: 0,
          },
        ],
      };
      await writeFile(filePath, JSON.stringify(v1Doc, null, 2));

      // Mutate: pin a session
      await pinSessionRecord(filePath, 's1');

      // Read back raw file — should be version 2
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as SessionIndexDocument;
      expect(parsed.version).toBe(2);
    });

    it('preserves existing v2 records on load', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-v2-load-'));
      const filePath = join(dir, 'index.json');

      const v2Doc = {
        version: 2 as const,
        sessions: [
          {
            id: 'general-1',
            projectPath: '',
            scope: { kind: 'general' as const },
            workingDirectory: '/tmp/.piwin/workspace',
            createdAt: '2026-07-25T10:00:00.000Z',
            updatedAt: '2026-07-25T10:00:00.000Z',
            messageCount: 0,
          },
          {
            id: 'proj-1',
            projectPath: '/tmp/my-project',
            scope: { kind: 'project' as const, projectPath: '/tmp/my-project' },
            workingDirectory: '/tmp/my-project',
            createdAt: '2026-07-25T11:00:00.000Z',
            updatedAt: '2026-07-25T11:00:00.000Z',
            messageCount: 2,
          },
        ],
      };
      await writeFile(filePath, JSON.stringify(v2Doc, null, 2));

      const loaded = await loadSessionIndex(filePath);
      expect(loaded.version).toBe(2);
      expect(loaded.sessions).toHaveLength(2);

      const general = loaded.sessions.find((item) => item.id === 'general-1');
      expect(general?.scope?.kind).toBe('general');
      expect(general?.workingDirectory).toBe('/tmp/.piwin/workspace');

      const project = loaded.sessions.find((item) => item.id === 'proj-1');
      expect(project?.scope?.kind).toBe('project');
      expect(project?.scope?.kind === 'project' && project.scope.projectPath).toBe('/tmp/my-project');
      expect(project?.workingDirectory).toBe('/tmp/my-project');
    });

    it('handles empty and corrupt files gracefully', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-corrupt-'));
      const filePath = join(dir, 'index.json');

      // Non-existent file
      const empty = await loadSessionIndex(filePath);
      expect(empty.version).toBe(2);
      expect(empty.sessions).toHaveLength(0);

      // Empty content
      await writeFile(filePath, '', 'utf8');
      const fromEmpty = await loadSessionIndex(filePath);
      expect(fromEmpty.version).toBe(2);
      expect(fromEmpty.sessions).toHaveLength(0);

      // Invalid JSON
      await writeFile(filePath, '{invalid', 'utf8');
      const fromCorrupt = await loadSessionIndex(filePath);
      expect(fromCorrupt.version).toBe(2);
      expect(fromCorrupt.sessions).toHaveLength(0);
    });
  });

  describe('scope isolation', () => {
    it('creates general sessions via createSessionRecord with scope', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-scope-'));
      const filePath = join(dir, 'index.json');

      const generalRecord = createSessionRecord({
        id: 'g1',
        projectPath: '',
        scope: { kind: 'general' },
        workingDirectory: '/tmp/.piwin/workspace',
        name: 'General Chat',
      });
      await upsertSessionRecord(filePath, generalRecord);

      const projectRecord = createSessionRecord({
        id: 'p1',
        projectPath: '/tmp/proj',
        scope: { kind: 'project', projectPath: '/tmp/proj' },
        workingDirectory: '/tmp/proj',
        name: 'Project Chat',
      });
      await upsertSessionRecord(filePath, projectRecord);

      // General list should only show general session
      const generalSessions = await listSessionsForProject(filePath, { kind: 'general' });
      expect(generalSessions).toHaveLength(1);
      expect(generalSessions[0]?.id).toBe('g1');

      // Project list should only show project session
      const projectSessions = await listSessionsForProject(filePath, {
        kind: 'project',
        projectPath: '/tmp/proj',
      });
      expect(projectSessions).toHaveLength(1);
      expect(projectSessions[0]?.id).toBe('p1');

      // A different project path should return empty
      const otherProject = await listSessionsForProject(filePath, {
        kind: 'project',
        projectPath: '/tmp/other',
      });
      expect(otherProject).toHaveLength(0);
    });

    it('general sessions never appear in legacy projectPath queries', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-legacy-scope-'));
      const filePath = join(dir, 'index.json');

      // General session with empty projectPath
      const general = createSessionRecord({
        id: 'g1',
        projectPath: '',
        scope: { kind: 'general' },
        workingDirectory: '/tmp/.piwin/workspace',
      });
      await upsertSessionRecord(filePath, general);

      // Project session
      const project = createSessionRecord({
        id: 'p1',
        projectPath: '/tmp/proj',
        scope: { kind: 'project', projectPath: '/tmp/proj' },
      });
      await upsertSessionRecord(filePath, project);

      // Listing by projectPath should not include general sessions
      const listed = await listSessionsForProject(filePath, '/tmp/proj');
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe('p1');

      // Listing by scope should correctly separate
      const generalList = await listSessionsForProject(filePath, { kind: 'general' });
      expect(generalList).toHaveLength(1);
      expect(generalList[0]?.id).toBe('g1');
    });

    it('listAllSessionRecords filters by scope or project path', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'piwin-list-all-'));
      const filePath = join(dir, 'index.json');

      await upsertSessionRecord(
        filePath,
        createSessionRecord({
          id: 'g1',
          projectPath: '',
          scope: { kind: 'general' },
          workingDirectory: '/tmp/.piwin/workspace',
        }),
      );
      await upsertSessionRecord(
        filePath,
        createSessionRecord({
          id: 'p1',
          projectPath: '/tmp/proj',
          scope: { kind: 'project', projectPath: '/tmp/proj' },
        }),
      );
      await upsertSessionRecord(
        filePath,
        createSessionRecord({
          id: 'p2',
          projectPath: '/tmp/other',
          scope: { kind: 'project', projectPath: '/tmp/other' },
        }),
      );

      // All sessions
      const all = await listAllSessionRecords(filePath);
      expect(all).toHaveLength(3);

      // General only
      const general = await listAllSessionRecords(filePath, { kind: 'general' });
      expect(general).toHaveLength(1);
      expect(general[0]?.id).toBe('g1');

      // Specific project
      const project = await listAllSessionRecords(filePath, '/tmp/proj');
      expect(project).toHaveLength(1);
      expect(project[0]?.id).toBe('p1');
    });
  });
});
