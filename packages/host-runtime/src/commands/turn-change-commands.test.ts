import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { handleTurnChangeCommand } from './turn-change-commands.js';

describe('turn-change command handlers', () => {
  it('returns unsupported-capability for turn-change commands until undo lands', async () => {
    const commands: HostCommand[] = [
      { type: 'turn-changes/get', changeSetId: 'cs-1' },
      { type: 'turn-changes/list-by-runs', sessionId: 'session-1', runIds: ['run-1'] },
      { type: 'turn-changes/files', changeSetId: 'cs-1', revision: 1 },
      { type: 'turn-changes/diff', changeSetId: 'cs-1', revision: 1, fileId: 'file-1' },
      { type: 'turn-changes/check', changeSetId: 'cs-1', revision: 1, direction: 'undo' },
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 1 },
      { type: 'turn-changes/redo', changeSetId: 'cs-1', expectedRevision: 1 },
      { type: 'turn-changes/operation', operationId: 'op-1' },
      { type: 'turn-changes/operations', workspaceId: 'ws-1' },
      { type: 'turn-changes/cancel', operationId: 'op-1' },
      { type: 'turn-changes/recovery-preview', operationId: 'op-1', expectedRevision: 1 },
      {
        type: 'turn-changes/recovery-run',
        operationId: 'op-1',
        expectedRevision: 1,
        confirmationToken: 'token-1',
      },
      { type: 'turn-changes/recovery-verify', operationId: 'op-1', expectedRevision: 1 },
    ];
    for (const command of commands) {
      const response = await handleTurnChangeCommand(command, 'request-turn-change');
      expect(response).toMatchObject({
        success: false,
        command: command.type,
        error: 'unsupported-capability',
        problem: { code: 'unsupported-capability' },
      });
    }
  });

  it('returns null for unrelated commands', async () => {
    expect(await handleTurnChangeCommand({ type: 'host/ping' }, 'request-ping')).toBeNull();
  });
});
