import { describe, expect, it } from 'vitest';
import { isSafeRemoteCommand } from './host-server-support.js';

describe('isSafeRemoteCommand session/cold-storage', () => {
  it('rejects remote cold-storage import regardless of packPath', () => {
    // Import resolves an arbitrary Host-absolute packPath; picking that file is
    // a local-sidecar operation, so remote clients must not send the command.
    expect(
      isSafeRemoteCommand({ type: 'session/cold-storage-import', packPath: '/home/me/pack.tar' }),
    ).toBe(false);
    expect(
      isSafeRemoteCommand({
        type: 'session/cold-storage-import',
        packPath: 'C:/Users/me/pack.tar',
      }),
    ).toBe(false);
  });

  it('allows restore only without a host-absolute packPath', () => {
    expect(isSafeRemoteCommand({ type: 'session/cold-storage-restore', sessionId: 's1' })).toBe(
      true,
    );
    expect(
      isSafeRemoteCommand({
        type: 'session/cold-storage-restore',
        sessionId: 's1',
        packPath: '/home/me/pack.tar',
      }),
    ).toBe(false);
  });
});
