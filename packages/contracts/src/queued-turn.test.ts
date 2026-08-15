import { describe, expect, it } from 'vitest';
import {
  isQueuedTurnPending,
  isQueuedTurnTerminal,
  QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION,
  QUEUED_TURN_MAX_PENDING_PER_SESSION,
} from './queued-turn.js';

describe('queued-turn contracts', () => {
  it('keeps lifecycle terminality explicit', () => {
    expect(isQueuedTurnPending('pending')).toBe(true);
    expect(isQueuedTurnPending('starting')).toBe(true);
    expect(isQueuedTurnTerminal('started')).toBe(true);
    expect(isQueuedTurnTerminal('cancelled')).toBe(true);
    expect(isQueuedTurnTerminal('failed')).toBe(true);
  });

  it('exposes bounded Host admission limits', () => {
    expect(QUEUED_TURN_MAX_PENDING_PER_SESSION).toBe(20);
    expect(QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION).toBe(512 * 1024);
  });
});
