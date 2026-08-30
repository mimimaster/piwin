import { describe, expect, it, vi } from 'vitest';
import { runTurnRedo, runTurnUndo } from './turn-change-command.js';

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
    expect(handleCommand).toHaveBeenCalledWith({
      type: 'turn-changes/undo',
      changeSetId: 'cs-1',
      expectedRevision: 2,
    });
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
    expect(handleCommand).toHaveBeenCalledWith({
      type: 'turn-changes/redo',
      changeSetId: 'cs-1',
      expectedRevision: 2,
    });
  });
});
