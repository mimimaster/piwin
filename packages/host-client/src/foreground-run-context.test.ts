import { describe, expect, it } from 'vitest';
import { createUnknownSessionContextSnapshot } from '@piwin/contracts';
import {
  applyHostPushToForeground,
  initialForegroundRunState,
  reduceForegroundRun,
} from './foreground-run-projection.js';

describe('foreground run ignores context occupancy pushes', () => {
  it('leaves run state unchanged for session/context-updated', () => {
    const active = reduceForegroundRun(
      initialForegroundRunState(),
      {
        type: 'run-updated',
        run: {
          runId: 'run-live',
          kind: 'session-turn',
          status: 'running',
          rootRunId: 'run-live',
          sessionId: 'session-1',
        },
      },
      'session-1',
    );
    const next = applyHostPushToForeground(
      active,
      {
        type: 'session/context-updated',
        sessionId: 'session-1',
        snapshot: createUnknownSessionContextSnapshot({
          sessionId: 'session-1',
          revision: 1,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          reason: 'never-sampled',
          updatedAt: '2026-08-30T00:00:00.000Z',
        }),
      },
      'session-1',
    );
    expect(next).toEqual(active);
  });
});
