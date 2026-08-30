/**
 * Two HostRuntime launches on the same mktemp piwinRoot must keep turn-change
 * data and advertised capabilities. Not a Tauri smoke.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostStatusData } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { openTurnChangeStore } from '@piwin/git';

const dirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(directory);
  return directory;
}

describe('Host launch turn-change persistence', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('advertises the same capabilities on two launches and undoes a recorded file', async () => {
    const piwinRoot = await tempDir('piwin-launch-root-');
    const workspaceRoot = await tempDir('piwin-launch-ws-');
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src/a.txt'), 'after\n');

    const first = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    const statusOne = await first.handleCommand({ type: 'host/status' });
    expect(statusOne.success).toBe(true);
    if (!statusOne.success) throw new Error(statusOne.error);
    const capsOne = statusOne.data as HostStatusData;
    expect(capsOne.capabilities.turnChangeUndoV1).toBe(true);
    expect(capsOne.capabilities.subagentDeliveryV1).toBe(true);
    await first.dispose();

    const storeRoot = join(piwinRoot, 'turn-changes');
    const store = openTurnChangeStore({ rootDir: storeRoot });
    const before = await store.putObject(new TextEncoder().encode('before\n'));
    const after = await store.putObject(new TextEncoder().encode('after\n'));
    store.registerWorkspace({
      workspaceId: 'ws-launch',
      rootPath: workspaceRoot,
      hostInstanceId: 'test-host',
    });
    store.createAttempt({
      changeSetId: 'cs-launch',
      attemptId: 'at-launch',
      sessionId: 'session-launch',
      workspaceId: 'ws-launch',
    });
    store.publishChangeVersion({
      changeSetId: 'cs-launch',
      revision: 1,
      files: [
        {
          relativePath: 'src/a.txt',
          beforeSha: before.sha256,
          afterSha: after.sha256,
          beforeExists: true,
          afterExists: true,
        },
      ],
      coverageComplete: true,
    });
    store.close();

    const second = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    const statusTwo = await second.handleCommand({ type: 'host/status' });
    expect(statusTwo.success).toBe(true);
    if (!statusTwo.success) throw new Error(statusTwo.error);
    const capsTwo = statusTwo.data as HostStatusData;
    expect(capsTwo.capabilities.turnChangeUndoV1).toBe(capsOne.capabilities.turnChangeUndoV1);
    expect(capsTwo.capabilities.subagentDeliveryV1).toBe(capsOne.capabilities.subagentDeliveryV1);

    const undo = await second.handleCommand({
      type: 'turn-changes/undo',
      changeSetId: 'cs-launch',
      expectedRevision: 1,
    });
    expect(undo.success).toBe(true);
    await second.dispose();

    const restored = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(workspaceRoot, 'src/a.txt'), 'utf8'),
    );
    expect(restored).toBe('before\n');
  });
});
