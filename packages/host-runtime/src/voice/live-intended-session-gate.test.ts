import { describe, expect, it } from 'vitest';
import { LiveIntendedSessionGate } from './live-intended-session-gate.js';

describe('LiveIntendedSessionGate', () => {
  it('starts unset (legacy admit)', () => {
    const gate = new LiveIntendedSessionGate();
    expect(gate.read('call-1')).toBeUndefined();
  });

  it('stores null as empty focus', () => {
    const gate = new LiveIntendedSessionGate();
    gate.set('call-1', null);
    expect(gate.read('call-1')).toBeNull();
  });

  it('stores a focused session id', () => {
    const gate = new LiveIntendedSessionGate();
    gate.set('call-1', 'session-b');
    expect(gate.read('call-1')).toBe('session-b');
  });

  it('does not leak across call ids', () => {
    const gate = new LiveIntendedSessionGate();
    gate.set('call-1', 'session-a');
    expect(gate.read('call-2')).toBeUndefined();
  });
});
