import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { isSafeRemoteCommand } from './remote-command-validation.js';

describe('remote browser conversation scope', () => {
  it.each(['browser/start', 'browser/stop', 'browser/reload', 'browser/restart'] as const)(
    'accepts legacy and conversation-scoped %s', (type) => {
      expect(isSafeRemoteCommand({ type })).toBe(true);
      expect(isSafeRemoteCommand({ type, sessionId: 'session-a' })).toBe(true);
    },
  );

  it.each(['', '   ', 'a'.repeat(1025), null, 42])(
    'rejects malformed browser scope %j', (sessionId) => {
      const command = { type: 'browser/start', sessionId } as unknown as HostCommand;
      expect(isSafeRemoteCommand(command)).toBe(false);
    },
  );
});
