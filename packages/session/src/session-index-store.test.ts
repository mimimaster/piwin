import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSessionRecord,
  listSessionsForProject,
  pinSessionRecord,
  unpinSessionRecord,
  upsertSessionRecord,
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
});
