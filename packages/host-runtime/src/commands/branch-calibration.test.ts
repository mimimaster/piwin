import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getPiwinSessionPendingBranchCalibrationPath } from '../paths.js';
import {
  clearPendingBranchCalibration,
  formatBranchCalibrationBlock,
  injectBranchCalibrationOnce,
  queuePendingBranchCalibration,
} from './branch-calibration.js';
import type { SessionLiveContext } from './session-live-context.js';

describe('formatBranchCalibrationBlock', () => {
  it('names abandoned files and unknown writes', () => {
    const block = formatBranchCalibrationBlock(
      { files: ['src/a.ts', 'src/b.ts'], hasUnknownWrites: true },
      'git status: clean',
    );
    expect(block).toContain('[piwin-branch-calibration]');
    expect(block).toContain('Disk files were not reverted');
    expect(block).toContain('- src/a.ts');
    expect(block).toContain('may have written files without recording paths');
    expect(block).toContain('git status: clean');
    expect(block).toContain('[/piwin-branch-calibration]');
  });

  it('injects the calibration block exactly once', async () => {
    const pending = new Map([
      ['s1', { files: ['src/a.ts'], hasUnknownWrites: false }],
    ]);
    const context = {
      piwinRoot: '/tmp/piwin-cal-missing',
      pendingBranchCalibrationBySession: pending,
      push: vi.fn(),
    } as unknown as SessionLiveContext;
    const first = { text: 'hello' };
    await injectBranchCalibrationOnce(context, 's1', first);
    expect(first.text).toContain('[piwin-branch-calibration]');
    expect(first.text).toContain('src/a.ts');
    expect(first.text).toContain('hello');
    expect(pending.size).toBe(0);
    const second = { text: 'follow up' };
    await injectBranchCalibrationOnce(context, 's1', second);
    expect(second.text).toBe('follow up');
  });

  it('reloads pending calibration from disk after a Host restart', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cal-persist-'));
    const sessionId = 'session-cal';
    const writes = { files: ['src/app.ts'], hasUnknownWrites: false };
    const queueContext = {
      piwinRoot: rootDir,
      pendingBranchCalibrationBySession: new Map(),
      push: vi.fn(),
    } as unknown as SessionLiveContext;
    await queuePendingBranchCalibration(queueContext, sessionId, writes);
    const filePath = getPiwinSessionPendingBranchCalibrationPath(rootDir, sessionId);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(writes);

    // Simulate Host restart: empty in-memory Map, durable file still present.
    const restartContext = {
      piwinRoot: rootDir,
      pendingBranchCalibrationBySession: new Map(),
      push: vi.fn(),
    } as unknown as SessionLiveContext;
    const prompt = { text: 'continue' };
    await injectBranchCalibrationOnce(restartContext, sessionId, prompt);
    expect(prompt.text).toContain('[piwin-branch-calibration]');
    expect(prompt.text).toContain('src/app.ts');
    expect(prompt.text).toContain('continue');
    expect(restartContext.pendingBranchCalibrationBySession.size).toBe(0);
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const again = { text: 'second' };
    await injectBranchCalibrationOnce(restartContext, sessionId, again);
    expect(again.text).toBe('second');
  });

  it('clearPendingBranchCalibration drops both map and file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cal-clear-'));
    const sessionId = 'session-clear';
    const pending = new Map();
    const context = {
      piwinRoot: rootDir,
      pendingBranchCalibrationBySession: pending,
      push: vi.fn(),
    } as unknown as SessionLiveContext;
    await queuePendingBranchCalibration(context, sessionId, {
      files: ['a.ts'],
      hasUnknownWrites: false,
    });
    await clearPendingBranchCalibration(context, sessionId);
    expect(pending.size).toBe(0);
    await expect(
      readFile(getPiwinSessionPendingBranchCalibrationPath(rootDir, sessionId), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
