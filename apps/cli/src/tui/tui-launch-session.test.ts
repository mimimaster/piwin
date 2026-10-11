import { describe, expect, it } from 'vitest';
import { resolveTuiLaunchSessionIntent } from './tui-launch-session.js';

describe('resolveTuiLaunchSessionIntent', () => {
  it('prefers an explicit session id', () => {
    expect(resolveTuiLaunchSessionIntent(['--session', 's1', '--continue'])).toEqual({
      kind: 'session',
      sessionId: 's1',
    });
    expect(resolveTuiLaunchSessionIntent(['--resume', 's2'])).toEqual({
      kind: 'session',
      sessionId: 's2',
    });
    expect(resolveTuiLaunchSessionIntent(['-r', 's3'])).toEqual({
      kind: 'session',
      sessionId: 's3',
    });
  });

  it('opens the picker for bare resume', () => {
    expect(resolveTuiLaunchSessionIntent(['--resume'])).toEqual({ kind: 'picker' });
    expect(resolveTuiLaunchSessionIntent(['-r'])).toEqual({ kind: 'picker' });
    expect(resolveTuiLaunchSessionIntent(['-r', '--mock'])).toEqual({ kind: 'picker' });
  });

  it('continues the latest session', () => {
    expect(resolveTuiLaunchSessionIntent(['--continue'])).toEqual({ kind: 'continue' });
    expect(resolveTuiLaunchSessionIntent(['-c'])).toEqual({ kind: 'continue' });
  });

  it('defaults to a fresh draft', () => {
    expect(resolveTuiLaunchSessionIntent([])).toEqual({ kind: 'none' });
  });
});
