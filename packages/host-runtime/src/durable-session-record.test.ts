import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionRecord, renameSessionRecord, updateSessionRecord } from '@piwin/session';
import { describe, expect, it } from 'vitest';
import { persistDurableSessionRecord } from './durable-session-record.js';

async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-durable-'));
  const indexPath = join(rootDir, 'sessions-index.json');
  return { rootDir, indexPath };
}

describe('persistDurableSessionRecord', () => {
  it('keeps a name the person chose when a runtime binds with the name it activated from', async () => {
    const { rootDir, indexPath } = await setup();
    await persistDurableSessionRecord({ rootDir, indexPath, sessionId: 's1', projectPath: '', sessionName: '会一直跑' });
    await renameSessionRecord(indexPath, 's1', '运行中会话');
    // The binding carries the record's name from before the rename.
    await persistDurableSessionRecord({ rootDir, indexPath, sessionId: 's1', projectPath: '', sessionName: '会一直跑' });
    expect(await getSessionRecord(indexPath, 's1')).toMatchObject({ name: '运行中会话', nameSource: 'user' });
  });

  it('still applies a name to a session nobody renamed', async () => {
    const { rootDir, indexPath } = await setup();
    await persistDurableSessionRecord({ rootDir, indexPath, sessionId: 's2', projectPath: '' });
    await persistDurableSessionRecord({ rootDir, indexPath, sessionId: 's2', projectPath: '', sessionName: '后来才有名字' });
    expect((await getSessionRecord(indexPath, 's2'))?.name).toBe('后来才有名字');
  });

  it('does not treat binding a runtime to an existing session as activity', async () => {
    const { rootDir, indexPath } = await setup();
    await persistDurableSessionRecord({ rootDir, indexPath, sessionId: 's3', projectPath: '' });
    const stale = '2026-01-01T00:00:00.000Z';
    await updateSessionRecord(indexPath, 's3', (record) => { record.updatedAt = stale; });
    await persistDurableSessionRecord({ rootDir, indexPath, sessionId: 's3', projectPath: '' });
    expect((await getSessionRecord(indexPath, 's3'))?.updatedAt).toBe(stale);
  });
});
