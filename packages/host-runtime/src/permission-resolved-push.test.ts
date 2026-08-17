import { describe, expect, it } from 'vitest';
import { permissionResolvedPushes } from './permission-resolved-push.js';

describe('permissionResolvedPushes', () => {
  it('emits a HostPush and a session event with the same decision', () => {
    const pushes = permissionResolvedPushes({
      sessionId: 'sess-1',
      requestId: 'req-1',
      decision: 'deny',
      runId: 'run-1',
    });
    expect(pushes).toEqual([
      {
        type: 'permission/resolved',
        sessionId: 'sess-1',
        requestId: 'req-1',
        decision: 'deny',
        runId: 'run-1',
      },
      {
        type: 'event',
        sessionId: 'sess-1',
        event: {
          type: 'permission/resolved',
          requestId: 'req-1',
          decision: 'deny',
          runId: 'run-1',
        },
      },
    ]);
  });
});
