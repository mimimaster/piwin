import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinSessionDir, getPiwinSessionIndexPath, getPiwinSessionMediaDir } from './paths.js';
import { permanentlyDeleteSession } from './session-delete-service.js';

describe('permanentlyDeleteSession', () => {
  it('quarantines files, removes the index record, and cleans the transaction', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-delete-session-'));
    const sessionId = 'session-delete';
    const indexPath = getPiwinSessionIndexPath(rootDir);
    await upsertSessionRecord(
      indexPath,
      createSessionRecord({ id: sessionId, projectPath: '/project', name: 'Delete me' }),
    );
    await mkdir(getPiwinSessionDir(rootDir, sessionId), { recursive: true });
    await mkdir(getPiwinSessionMediaDir(rootDir, sessionId), { recursive: true });
    await writeFile(join(getPiwinSessionDir(rootDir, sessionId), 'payload.txt'), 'session');
    await writeFile(join(getPiwinSessionMediaDir(rootDir, sessionId), 'image.txt'), 'media');

    const result = await permanentlyDeleteSession({ rootDir, indexPath, sessionId });

    expect(result?.removed.id).toBe(sessionId);
    expect(await getSessionRecord(indexPath, sessionId)).toBeUndefined();
    await expect(access(getPiwinSessionDir(rootDir, sessionId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(getPiwinSessionMediaDir(rootDir, sessionId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('restores quarantined directories when the index mutation fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-delete-restore-'));
    const sessionId = 'session-restore';
    const invalidIndexPath = join(rootDir, 'index-is-a-directory');
    await mkdir(invalidIndexPath, { recursive: true });
    await mkdir(getPiwinSessionDir(rootDir, sessionId), { recursive: true });
    await mkdir(getPiwinSessionMediaDir(rootDir, sessionId), { recursive: true });
    await writeFile(join(getPiwinSessionDir(rootDir, sessionId), 'payload.txt'), 'session');
    await writeFile(join(getPiwinSessionMediaDir(rootDir, sessionId), 'image.txt'), 'media');

    await expect(
      permanentlyDeleteSession({
        rootDir,
        indexPath: invalidIndexPath,
        sessionId,
      }),
    ).rejects.toBeDefined();

    expect(
      await readFile(join(getPiwinSessionDir(rootDir, sessionId), 'payload.txt'), 'utf8'),
    ).toBe('session');
    expect(
      await readFile(join(getPiwinSessionMediaDir(rootDir, sessionId), 'image.txt'), 'utf8'),
    ).toBe('media');
  });

  it('rejects traversal before creating a quarantine transaction', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-delete-path-'));
    await expect(
      permanentlyDeleteSession({
        rootDir,
        indexPath: getPiwinSessionIndexPath(rootDir),
        sessionId: '../escape',
      }),
    ).rejects.toThrow(/separators/);
  });
});
