import { describe, expect, it, vi } from 'vitest';
import { formatBranchCalibrationBlock, injectBranchCalibrationOnce } from './branch-calibration.js';
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
});
