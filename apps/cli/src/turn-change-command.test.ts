import { describe, expect, it, vi } from 'vitest';
import { runTurnRedo, runTurnShow, runTurnUndo } from './turn-change-command.js';

describe('runTurnUndo / runTurnRedo', () => {
  it('sends turn-changes/undo with expectedRevision', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/undo',
      success: true as const,
      data: { operationId: 'op-1', status: 'succeeded' },
    }));
    const lines: string[] = [];
    await runTurnUndo(
      { handleCommand },
      'cs-1',
      2,
      (line) => {
        lines.push(line);
      },
    );
    // Attached Hosts refuse undo without an idempotency key.
    expect(handleCommand).toHaveBeenCalledWith(
      { type: 'turn-changes/undo', changeSetId: 'cs-1', expectedRevision: 2 },
      { idempotencyKey: expect.any(String) },
    );
    expect(lines[0]).toContain('op-1');
  });

  it('sends turn-changes/redo with expectedRevision', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/redo',
      success: true as const,
      data: { operationId: 'op-2', status: 'succeeded' },
    }));
    await runTurnRedo({ handleCommand }, 'cs-1', 2, () => undefined);
    expect(handleCommand).toHaveBeenCalledWith(
      { type: 'turn-changes/redo', changeSetId: 'cs-1', expectedRevision: 2 },
      { idempotencyKey: expect.any(String) },
    );
  });

  it('shows each change set with its undo availability and excluded files', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/list-by-runs',
      success: true as const,
      data: {
        summaries: [
          {
            changeSetId: 'cs-1',
            revision: 1,
            captureState: 'ready',
            disposition: 'applied',
            fileCount: 2,
            additions: 3,
            deletions: 1,
            undo: { allowed: true },
            redo: { allowed: false, reason: 'direction-unavailable' },
            incompleteReason: null,
            excludedPaths: ['gen.txt'],
          },
        ],
      },
    }));
    const lines: string[] = [];
    await runTurnShow({ handleCommand }, 'session-1', ['run-1'], (line) => lines.push(line));
    expect(handleCommand).toHaveBeenCalledWith({
      type: 'turn-changes/list-by-runs',
      sessionId: 'session-1',
      runIds: ['run-1'],
    });
    expect(lines[0]).toBe(
      'cs-1 rev 1 · ready/applied · 2 files +3 -1 · undo: yes · redo: no (direction-unavailable) · not undone (changed by commands): gen.txt',
    );
  });
});
