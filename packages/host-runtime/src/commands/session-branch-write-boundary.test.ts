import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SessionBranchSwitchData, WorkspaceWrites } from '@piwin/contracts';
import { openSessionTranscriptStore, upsertSessionRecord } from '@piwin/session';
import { getPiwinSessionIndexPath } from '../paths.js';
import { handleSessionBranchCommand } from './session-branch-commands.js';
import type { SessionLiveContext } from './session-live-context.js';

describe('branch-switch write boundary', () => {
  it('refuses an unconfirmed switch when the abandoned path wrote files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-branch-writes-'));
    const sessionId = 'session-writes';
    await upsertSessionRecord(getPiwinSessionIndexPath(rootDir), {
      id: sessionId,
      projectPath: '/tmp/project',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      workingDirectory: '/tmp/project',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      messageCount: 5,
    });
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId,
      projectPath: '/tmp/project',
    });
    await append(store, 'u1', 'user', 'first');
    await append(store, 'a1', 'assistant', 'ok');
    await append(store, 'u2', 'user', 'edit it');
    await store.appendMessage({
      id: 'a2',
      runtimeGenerationId: 'gen-a',
      backendMessageId: 'b-a2',
      role: 'assistant',
      text: 'wrote',
      status: 'done',
      createdAt: '2026-08-21T00:00:04.000Z',
      metadata: { workspaceWrites: { files: ['src/app.ts'], hasUnknownWrites: false } },
    });
    await store.rebaseActiveLeaf('a1');
    await append(store, 'u2-alt', 'user', 'other direction');
    await store.switchActiveBranch('u2');

    const pending = new Map<string, WorkspaceWrites>();
    const context = {
      piwinRoot: rootDir,
      getTranscriptStore: async () => store,
      getForegroundRun: () => undefined,
      tryReserveSessionBody: () => true,
      releaseSessionBody: () => undefined,
      disposeLiveSession: vi.fn(async () => undefined),
      pendingBranchCalibrationBySession: pending,
      push: () => undefined,
    } as unknown as SessionLiveContext;

    const blocked = await handleSessionBranchCommand(
      { type: 'session/branch-switch', sessionId, targetMessageId: 'u2-alt' },
      undefined,
      context,
    );
    expect(blocked?.success).toBe(true);
    const blockedData = blocked?.success
      ? (blocked.data as SessionBranchSwitchData)
      : undefined;
    expect(blockedData).toEqual({
      status: 'needs-confirmation',
      offPathWrites: { files: ['src/app.ts'], hasUnknownWrites: false },
    });
    expect(context.disposeLiveSession).not.toHaveBeenCalled();
    expect(await store.getActiveLeaf()).toBe('a2');

    const confirmed = await handleSessionBranchCommand(
      {
        type: 'session/branch-switch',
        sessionId,
        targetMessageId: 'u2-alt',
        confirm: true,
      },
      undefined,
      context,
    );
    expect(confirmed?.success).toBe(true);
    const confirmedData = confirmed?.success
      ? (confirmed.data as SessionBranchSwitchData)
      : undefined;
    expect(confirmedData?.status).toBe('switched');
    expect(await store.getActiveLeaf()).toBe('u2-alt');
    expect(pending.get(sessionId)).toEqual({
      files: ['src/app.ts'],
      hasUnknownWrites: false,
    });

    // An unknown target must still surface as a real failure, not as a
    // confirmation prompt for writes it never forked from.
    const unknown = await handleSessionBranchCommand(
      { type: 'session/branch-switch', sessionId, targetMessageId: 'nope' },
      undefined,
      context,
    );
    expect(unknown?.success).toBe(false);
    store.close();
  });
});

async function append(
  store: Awaited<ReturnType<typeof openSessionTranscriptStore>>,
  id: string,
  role: 'user' | 'assistant',
  text: string,
): Promise<void> {
  const result = await store.appendMessage({
    id,
    runtimeGenerationId: 'gen-a',
    backendMessageId: `b-${id}`,
    role,
    text,
    status: 'done',
    createdAt: `2026-08-21T00:00:0${id.length}.000Z`,
  });
  if (!result.ok) {
    throw new Error(`append ${id} failed`);
  }
}
