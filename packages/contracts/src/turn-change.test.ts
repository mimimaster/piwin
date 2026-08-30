import { describe, expect, it } from 'vitest';
import type { HostCommand, HostPush } from './ipc.js';
import type {
  TurnChangeAvailability,
  TurnChangeBlockReason,
  TurnChangeSummary,
} from './turn-change.js';

const BLOCK_REASONS: readonly TurnChangeBlockReason[] = [
  'unsupported-workspace',
  'capture-incomplete',
  'data-expired',
  'workspace-busy',
  'workspace-restoring',
  'foreign-host-active',
  'stale-revision',
  'files-changed',
  'staged-paths',
  'git-baseline-changed',
  'backup-failed',
  'needs-repair',
  'permission-denied',
  'direction-unavailable',
];

function sampleSummary(): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    workspaceId: 'ws-1',
    userMessageId: 'msg-1',
    runIds: ['run-1'],
    revision: 2,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 4,
    additions: 12,
    deletions: 3,
    binaryFileCount: 1,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: '2026-09-30T00:00:00.000Z',
    latestOperationId: null,
  };
}

describe('turn-change types', () => {
  it('constructs a TurnChangeSummary with both availability arms', () => {
    const allowed: TurnChangeAvailability = { allowed: true };
    const blocked: TurnChangeAvailability = {
      allowed: false,
      reason: 'files-changed',
      affectedPaths: ['src/a.ts'],
    };
    const blockedWithoutPaths: TurnChangeAvailability = {
      allowed: false,
      reason: 'workspace-busy',
    };
    const summary = sampleSummary();
    summary.undo = allowed;
    summary.redo = blocked;
    expect(summary.captureState).toBe('ready');
    expect(summary.disposition).toBe('applied');
    expect(summary.userMessageId).toBe('msg-1');
    expect(summary.fileCount).toBe(4);
    expect(summary.undo).toEqual({ allowed: true });
    expect(summary.redo).toEqual({
      allowed: false,
      reason: 'files-changed',
      affectedPaths: ['src/a.ts'],
    });
    expect(blockedWithoutPaths).toEqual({ allowed: false, reason: 'workspace-busy' });
    expect('reason' in allowed).toBe(false);
    expect('affectedPaths' in blockedWithoutPaths).toBe(false);
  });

  it('accepts every documented block reason', () => {
    const blocked: Array<Extract<TurnChangeAvailability, { allowed: false }>> = BLOCK_REASONS.map(
      (reason) => ({
        allowed: false,
        reason,
      }),
    );
    expect(blocked.map((entry) => entry.reason)).toEqual([...BLOCK_REASONS]);
  });

  it('accepts every turn-changes command shape', () => {
    const commands: HostCommand[] = [
      { type: 'turn-changes/get', changeSetId: 'cs-1' },
      { type: 'turn-changes/list-by-runs', sessionId: 'session-1', runIds: ['run-1'] },
      { type: 'turn-changes/files', changeSetId: 'cs-1', revision: 2 },
      {
        type: 'turn-changes/files',
        changeSetId: 'cs-1',
        revision: 2,
        cursor: 'c1',
        limit: 20,
      },
      { type: 'turn-changes/diff', changeSetId: 'cs-1', revision: 2, fileId: 'file-1' },
      { type: 'turn-changes/check', changeSetId: 'cs-1', revision: 2, direction: 'undo' },
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 2 },
      { type: 'turn-changes/redo', changeSetId: 'cs-1', expectedRevision: 2 },
      { type: 'turn-changes/operation', operationId: 'op-1' },
      { type: 'turn-changes/operations', workspaceId: 'ws-1' },
      { type: 'turn-changes/operations', workspaceId: 'ws-1', cursor: 'c1' },
      { type: 'turn-changes/cancel', operationId: 'op-1' },
      {
        type: 'turn-changes/recovery-preview',
        operationId: 'op-1',
        expectedRevision: 2,
      },
      {
        type: 'turn-changes/recovery-run',
        operationId: 'op-1',
        expectedRevision: 2,
        confirmationToken: 'token-1',
      },
      {
        type: 'turn-changes/recovery-verify',
        operationId: 'op-1',
        expectedRevision: 2,
      },
    ];
    expect(commands.map((command) => command.type)).toEqual([
      'turn-changes/get',
      'turn-changes/list-by-runs',
      'turn-changes/files',
      'turn-changes/files',
      'turn-changes/diff',
      'turn-changes/check',
      'turn-changes/undo',
      'turn-changes/redo',
      'turn-changes/operation',
      'turn-changes/operations',
      'turn-changes/operations',
      'turn-changes/cancel',
      'turn-changes/recovery-preview',
      'turn-changes/recovery-run',
      'turn-changes/recovery-verify',
    ]);
  });

  it('accepts every turn-changes push shape', () => {
    const summary = sampleSummary();
    const updated: HostPush = {
      type: 'turn-changes/updated',
      workspaceId: 'ws-1',
      changeSetId: 'cs-1',
      revision: 2,
      summary,
    };
    const operationUpdated: HostPush = {
      type: 'turn-changes/operation-updated',
      workspaceId: 'ws-1',
      operationId: 'op-1',
      changeSetId: 'cs-1',
    };
    const filesUpdated: HostPush = { type: 'workspace-files-updated', workspaceId: 'ws-1' };
    expect(updated.type).toBe('turn-changes/updated');
    expect(operationUpdated.type).toBe('turn-changes/operation-updated');
    expect(filesUpdated.type).toBe('workspace-files-updated');
    if (updated.type === 'turn-changes/updated') {
      expect(updated.summary.changeSetId).toBe('cs-1');
      expect(updated.revision).toBe(2);
    }
  });
});
