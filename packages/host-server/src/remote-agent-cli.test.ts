import type { HostCommand } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { isSafeRemoteCommand } from './remote-command-validation.js';

describe('remote agent terminal admission', () => {
  const valid: HostCommand = { type: 'agents/cli-open', input: { agentId: 'grok', sessionId: 'session-1', cols: 80, rows: 24 } };
  it('accepts bounded session ids and opaque project ids', () => {
    expect(isSafeRemoteCommand(valid)).toBe(true);
    expect(isSafeRemoteCommand({ type: 'agents/cli-open', input: { agentId: 'grok', projectPath: 'project-'+'a'.repeat(24), cols: 80, rows: 24 } })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'pty/write', ptyId: 'pty-1', data: '\x03你好' })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'agents/cli-sync', sessionId: 'session-1' })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'agents/cli-snapshot', sessionId: 'session-1' })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'agents/cli-snapshot', sessionId: '../escape' })).toBe(false);
    expect(isSafeRemoteCommand({ type: 'agents/cli-status', sessionId: 'session-1' })).toBe(true);
    expect(isSafeRemoteCommand({
      type: 'session/backend-input-respond',
      sessionId: 'session-1',
      requestId: 'req-1',
      generationId: 'gen-1',
      result: { cancelled: true },
    })).toBe(true);
    expect(isSafeRemoteCommand({
      type: 'session/backend-input-respond',
      sessionId: 'session-1',
      requestId: 'req-1',
      generationId: 'gen-1',
      result: { cancelled: true, answers: [] },
    } as never)).toBe(false);
  });
  it('blocks host paths, unknown agents, spawn overrides, malformed ids and unbounded I/O', () => {
    for (const input of [
      null,
      { agentId: 'pi', cols: 80, rows: 24 },
      { agentId: 'grok', projectPath: '/private/repo', cols: 80, rows: 24 },
      { agentId: 'grok', sessionId: null, cols: 80, rows: 24 },
      { agentId: 'grok', cols: 1001, rows: 24 },
      { agentId: 'grok', cols: 80, rows: 24, executable: '/usr/bin/grok' },
      { agentId: 'grok', cols: 80, rows: 24, cwd: '/tmp', env: {} },
    ]) {
      expect(isSafeRemoteCommand({ type: 'agents/cli-open', input } as unknown as HostCommand)).toBe(false);
    }
    expect(isSafeRemoteCommand({ type: 'pty/write', ptyId: 'pty-1', data: 'x'.repeat(65537) })).toBe(false);
    expect(isSafeRemoteCommand({ type: 'pty/resize', ptyId: 'pty-1', cols: 80, rows: -1 })).toBe(false);
  });
});
