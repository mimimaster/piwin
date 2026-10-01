import { describe, expect, it, vi } from 'vitest';
import {
  runTurnCancel,
  runTurnExport,
  runTurnOperations,
  runTurnRedo,
  runTurnRepair,
  runTurnShow,
  runTurnUndo,
} from './turn-change-command.js';

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

  it('names the files that block undo and folds a long command-changed list', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/list-by-runs',
      success: true as const,
      data: {
        summaries: [
          {
            changeSetId: 'cs-2',
            revision: 1,
            captureState: 'incomplete',
            disposition: 'applied',
            fileCount: 1,
            additions: 1,
            deletions: 0,
            undo: { allowed: false, reason: 'capture-incomplete' },
            redo: { allowed: false, reason: 'capture-incomplete' },
            incompleteReason: 'command-overlap',
            overlappingPaths: ['a.ts'],
            excludedPaths: ['1', '2', '3', '4', '5', '6', '7'],
          },
        ],
      },
    }));
    const lines: string[] = [];
    await runTurnShow({ handleCommand }, 'session-1', ['run-1'], (line) => lines.push(line));
    expect(lines[0]).toContain('incomplete: command-overlap');
    expect(lines[0]).toContain('blocking (a command also changed): a.ts');
    expect(lines[0]).toContain('not undone (changed by commands): 1, 2, 3, 4, 5 (+2 more)');
  });

  it('says which command-created files a successful undo left in place', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/undo',
      success: true as const,
      data: { operationId: 'op-1', status: 'succeeded', skippedPaths: ['gen.log', 'out.txt'] },
    }));
    const lines: string[] = [];
    await runTurnUndo({ handleCommand }, 'cs-1', 1, (line) => lines.push(line));
    expect(lines).toEqual([
      'undo succeeded op-1',
      'left in place (created by commands, changed since): gen.log, out.txt',
    ]);
  });

  it('fails an undo the Host rejected and names the files', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/undo',
      success: true as const,
      data: { operationId: 'op-1', status: 'rejected', reason: 'files-changed', affectedPaths: ['a.ts'] },
    }));
    await expect(runTurnUndo({ handleCommand }, 'cs-1', 1, () => undefined)).rejects.toThrow(
      'undo not applied (files-changed: files changed after the turn; nothing was modified): a.ts',
    );
  });

  it('names the later turn behind each blocked file, or an unknown source', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/undo',
      success: true as const,
      data: {
        operationId: 'op-1',
        status: 'rejected',
        reason: 'files-changed',
        affectedPaths: ['a.ts', 'b.ts'],
        conflicts: [
          { relativePath: 'a.ts', laterTurns: [{ changeSetId: 'cs-2', sessionId: 's-2', runIds: ['r2'], endedAt: null }] },
          { relativePath: 'b.ts', laterTurns: [] },
        ],
      },
    }));
    const lines: string[] = [];
    await expect(runTurnUndo({ handleCommand }, 'cs-1', 1, (line) => lines.push(line))).rejects.toThrow(
      'undo not applied (files-changed',
    );
    expect(lines).toEqual([
      'undo rejected op-1',
      '  a.ts: changed later by cs-2 (session s-2)',
      '  b.ts: source unknown (not changed by a recorded turn)',
    ]);
  });

  it('explains a staged-paths refusal', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/undo',
      success: true as const,
      data: { operationId: 'op-1', status: 'rejected', reason: 'staged-paths', affectedPaths: ['a.ts'] },
    }));
    await expect(runTurnUndo({ handleCommand }, 'cs-1', 1, () => undefined)).rejects.toThrow(
      'undo not applied (staged-paths: paths are staged or unmerged in Git; unstage or resolve first (undo never touches the index)): a.ts',
    );
  });
});

describe('runTurnExport', () => {
  it('exports with a gesture key and prints where', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/export-backup',
      success: true as const,
      data: { operationId: 'op-1', destination: '/out/piwin-undo-backup-op-1', exportedPaths: ['a.ts', 'b.ts'] },
    }));
    const lines: string[] = [];
    await runTurnExport({ handleCommand }, 'op-1', '/out', (line) => lines.push(line));
    expect(handleCommand).toHaveBeenCalledWith(
      { type: 'turn-changes/export-backup', operationId: 'op-1', destination: '/out' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(lines).toEqual(['exported 2 files to /out/piwin-undo-backup-op-1']);
  });

  it('fails on a refusal', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'turn-changes/export-backup',
      success: false as const,
      error: 'destination must be outside the workspace',
    }));
    await expect(runTurnExport({ handleCommand }, 'op-1', '/ws', () => undefined)).rejects.toThrow(
      'destination must be outside the workspace',
    );
  });
});

describe('turn operation record', () => {
  const entry = {
    operationId: 'op-1',
    changeSetId: 'cs-1',
    sessionId: 's-1',
    workspaceId: 'ws-1',
    direction: 'undo',
    status: 'succeeded',
    revision: 1,
    fileCount: 2,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:01.000Z',
    superseded: true,
    summary: null,
  };

  it('pages through operations for a project path', async () => {
    const handleCommand = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'response', command: 'turn-changes/operations', success: true,
        data: { workspaceId: 'ws-1', operations: [entry], nextCursor: 'c1' },
      })
      .mockResolvedValueOnce({
        type: 'response', command: 'turn-changes/operations', success: true,
        data: { workspaceId: 'ws-1', operations: [], nextCursor: null },
      });
    const lines: string[] = [];
    await runTurnOperations({ handleCommand }, '/repo', (line) => lines.push(line));
    expect(handleCommand).toHaveBeenNthCalledWith(2, {
      type: 'turn-changes/operations',
      projectPath: '/repo',
      cursor: 'c1',
    });
    expect(lines).toEqual([
      'op-1 · undo succeeded · change set cs-1 rev 1 · 2 files · 2026-09-30T10:00:00.000Z · superseded',
    ]);
  });

  it('reports a cancel that came too late', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const, command: 'turn-changes/cancel', success: true as const,
      data: { status: 'applying', cancelled: false, reason: 'write-started' },
    }));
    const lines: string[] = [];
    await runTurnCancel({ handleCommand }, 'op-1', (line) => lines.push(line));
    expect(handleCommand).toHaveBeenCalledWith(
      { type: 'turn-changes/cancel', operationId: 'op-1' },
      { idempotencyKey: expect.any(String) },
    );
    expect(lines[0]).toContain('already started writing');
  });

  it('repair previews only, unless confirmed', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const, command: 'turn-changes/recovery-preview', success: true as const,
      data: { operationId: 'op-1', changeSetId: 'cs-1', revision: 1, status: 'needs-repair',
        files: [{ relativePath: 'a.ts', state: 'operation-content' }], confirmationToken: 'tok' },
    }));
    const lines: string[] = [];
    await runTurnRepair({ handleCommand }, 'op-1', 1, false, (line) => lines.push(line));
    expect(handleCommand).toHaveBeenCalledTimes(1);
    expect(lines.at(-1)).toContain('--yes');
  });
});
