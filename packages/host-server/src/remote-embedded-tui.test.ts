import { describe, expect, it } from 'vitest';
import { createRemoteProjectId } from '@piwin/host-runtime';
import { isSafeRemoteCommand } from './remote-command-validation.js';

describe('isSafeRemoteCommand tui/open', () => {
  it('admits a session or an opaque project id with a grid', () => {
    expect(isSafeRemoteCommand({ type: 'tui/open', input: { cols: 48, rows: 30 } })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'tui/open', input: { sessionId: 'session-1', cols: 48, rows: 30 } })).toBe(true);
    expect(isSafeRemoteCommand({
      type: 'tui/open',
      input: { projectPath: createRemoteProjectId('/Users/someone/piwin'), cols: 48, rows: 30 },
    })).toBe(true);
  });

  it('never lets a remote client name a Host path or a flag', () => {
    expect(isSafeRemoteCommand({ type: 'tui/open', input: { projectPath: '/Users/someone/piwin', cols: 48, rows: 30 } })).toBe(false);
    expect(isSafeRemoteCommand({ type: 'tui/open', input: { sessionId: '--version', cols: 48, rows: 30 } })).toBe(false);
  });
});
