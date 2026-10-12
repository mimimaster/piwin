import { describe, expect, it } from 'vitest';
import {
  isAgentCliFailureCode,
  isAgentCliOpenInput,
  isAgentCliOwnership,
  isValidTerminalSize,
} from './agent-cli.js';
import { remoteCommandRequiresIdempotencyKey } from './remote-idempotency.js';
import { FALLBACK_REMOTE_ALLOWED_COMMANDS, remoteHostSupportsCommand } from './remote-protocol.js';

describe('native agent terminal contracts', () => {
  it('validates a bounded integer grid', () => {
    expect(isValidTerminalSize(80, 24)).toBe(true);
    for (const [cols, rows] of [[0, 24], [80, 0], [1001, 24], [80, 501], [80.5, 24], [NaN, 24], ['80', 24]]) {
      expect(isValidTerminalSize(cols, rows)).toBe(false);
    }
  });

  it('accepts legacy Grok open shapes and other external backend slugs', () => {
    expect(isAgentCliOpenInput({ agentId: 'grok', cols: 80, rows: 24 })).toBe(true);
    expect(isAgentCliOpenInput({
      agentId: 'grok',
      sessionId: 'session-1',
      projectPath: 'project-' + 'a'.repeat(24),
      cols: 120,
      rows: 40,
    })).toBe(true);
    expect(isAgentCliOpenInput({ agentId: 'claude-code', cols: 80, rows: 24 })).toBe(true);
  });

  it('rejects Pi, malformed ids, spawn overrides and unknown fields', () => {
    for (const input of [
      { agentId: 'pi', cols: 80, rows: 24 },
      { agentId: 'Grok', cols: 80, rows: 24 },
      { agentId: 'grok', cols: 80, rows: 24, executable: '/usr/bin/grok' },
      { agentId: 'grok', cols: 80, rows: 24, argv: ['--resume', 'x'] },
      { agentId: 'grok', cols: 80, rows: 24, env: { PATH: '/' } },
      { agentId: 'grok', cols: 80, rows: 24, cwd: '/tmp' },
      { agentId: 'grok', cols: 1001, rows: 24 },
      { agentId: 'grok', sessionId: '', cols: 80, rows: 24 },
      { agentId: 'grok', projectPath: 'x\0y', cols: 80, rows: 24 },
      null,
      'grok',
    ]) {
      expect(isAgentCliOpenInput(input)).toBe(false);
    }
  });

  it('distinguishes Host-managed ownership shapes and stable failure codes', () => {
    expect(isAgentCliOwnership({ kind: 'desktop', sessionId: 's1' })).toBe(true);
    expect(isAgentCliOwnership({ kind: 'native', sessionId: 's1', ptyId: 'pty-1' })).toBe(true);
    expect(isAgentCliOwnership({ kind: 'switching', sessionId: 's1', target: 'desktop' })).toBe(true);
    expect(isAgentCliOwnership({ kind: 'switching', sessionId: 's1', target: 'native', ptyId: 'pty-1' })).toBe(true);
    expect(isAgentCliOwnership({ kind: 'native', sessionId: 's1' })).toBe(false);
    expect(isAgentCliOwnership({ kind: 'desktop', sessionId: 's1', ptyId: 'pty-1' })).toBe(false);
    expect(isAgentCliFailureCode('cli-unsupported')).toBe(true);
    expect(isAgentCliFailureCode('writer-busy')).toBe(true);
    expect(isAgentCliFailureCode('unsupported-agent-cli')).toBe(false);
  });

  it('advertises agent terminal control for remote operators', () => {
    expect(remoteCommandRequiresIdempotencyKey('agents/cli-open')).toBe(true);
    for (const type of ['agents/cli-open', 'agents/cli-sync', 'pty/write', 'pty/resize', 'pty/close'] as const) {
      expect(remoteHostSupportsCommand(FALLBACK_REMOTE_ALLOWED_COMMANDS, type)).toBe(true);
    }
  });
});
