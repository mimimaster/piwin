import { expect, it } from 'vitest';
import { sortPinnedThenUpdated } from './sidebar-session-order.js';
it('orders recent native work with other active runs and clears the running bucket when it settles', () => {
  const native = { id: 'grok', name: 'Grok', updatedAt: '2026-10-12T10:00:00Z', nativeCli: { kind: 'native' as const, sessionId: 'grok', ptyId: 'pty', activity: 'running' as const } };
  const other = { id: 'pi', name: 'Pi', updatedAt: '2026-10-12T09:00:00Z' };
  const idle = { id: 'idle', name: 'Idle', updatedAt: '2026-10-12T11:00:00Z' };
  const activity = { workingSessionIds: { pi: true as const }, revealSessionId: 'grok', runPhase: 'idle' as const };
  expect(sortPinnedThenUpdated([other, idle, native], activity).map((session) => session.id)).toEqual(['grok', 'pi', 'idle']);
  expect(sortPinnedThenUpdated([other, idle, { ...native, nativeCli: { ...native.nativeCli, activity: 'idle' } }], activity).map((session) => session.id)).toEqual(['pi', 'idle', 'grok']);
});
