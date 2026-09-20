import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { touchSession } from './host-runtime-session-index.js';
import { getPiwinSessionIndexPath } from './paths.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function kernelStub(root: string, pushes: HostPush[]): HostRuntimeKernel {
  return {
    options: { piwinRoot: root },
    sessionProjects: new Map<string, string>(),
    push: (message: HostPush) => {
      pushes.push(message);
    },
  } as unknown as HostRuntimeKernel;
}

describe('touchSession', () => {
  it('bumps updatedAt and pushes session/index-updated for an existing record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-touch-session-'));
    cleanup.push(root);
    const indexPath = getPiwinSessionIndexPath(root);
    const record = createSessionRecord({
      id: 's1',
      projectPath: '/proj',
      name: 'Named chat',
    });
    record.updatedAt = '2026-01-01T00:00:00.000Z';
    record.messageCount = 3;
    await upsertSessionRecord(indexPath, record);

    const pushes: HostPush[] = [];
    await touchSession(kernelStub(root, pushes), 's1', 'hello from the latest turn');

    const stored = await getSessionRecord(indexPath, 's1');
    expect(stored?.messageCount).toBe(4);
    expect(stored?.lastPreview).toBe('hello from the latest turn');
    expect(Date.parse(stored?.updatedAt ?? '')).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00.000Z'),
    );
    expect(pushes).toHaveLength(1);
    const push = pushes[0];
    expect(push).toMatchObject({
      type: 'session/index-updated',
      op: 'updated',
      sessionId: 's1',
    });
    if (push?.type !== 'session/index-updated') {
      throw new Error('expected session/index-updated');
    }
    expect(push.session?.updatedAt).toBe(stored?.updatedAt);
    expect(push.session?.lastPreview).toBe('hello from the latest turn');
  });
});
