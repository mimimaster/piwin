import { describe, expect, it } from 'vitest';
import { isValidTerminalSize } from './agent-cli.js';
import { remoteCommandRequiresIdempotencyKey } from './remote-idempotency.js';
import { FALLBACK_REMOTE_ALLOWED_COMMANDS, remoteHostSupportsCommand } from './remote-protocol.js';

describe('native agent terminal contracts', () => {
  it('validates a bounded integer grid', () => {
    expect(isValidTerminalSize(80, 24)).toBe(true);
    for (const [cols, rows] of [[0, 24], [80, 0], [1001, 24], [80, 501], [80.5, 24], [NaN, 24], ['80', 24]]) {
      expect(isValidTerminalSize(cols, rows)).toBe(false);
    }
  });
  it('advertises agent terminal control for remote operators', () => {
    expect(remoteCommandRequiresIdempotencyKey('agents/cli-open')).toBe(true);
    for (const type of ['agents/cli-open', 'agents/cli-sync', 'pty/write', 'pty/resize', 'pty/close'] as const) {
      expect(remoteHostSupportsCommand(FALLBACK_REMOTE_ALLOWED_COMMANDS, type)).toBe(true);
    }
  });
});
