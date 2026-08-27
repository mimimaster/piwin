import { describe, expect, it } from 'vitest';
import { createEventEnvelopeGenerator } from './host-event-envelope.js';

describe('createEventEnvelopeGenerator', () => {
  it('produces monotonically increasing sequence numbers', () => {
    const generator = createEventEnvelopeGenerator('run-1');
    const first = generator.next();
    const second = generator.next();
    const third = generator.next();
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(third.sequence).toBe(3);
    expect(first.runId).toBe('run-1');
    expect(second.runId).toBe('run-1');
    expect(third.runId).toBe('run-1');
  });

  it('produces unique eventIds per call', () => {
    const generator = createEventEnvelopeGenerator();
    expect(generator.next().eventId).not.toBe(generator.next().eventId);
  });

  it('allows per-call runId override', () => {
    const generator = createEventEnvelopeGenerator('default-run');
    expect(generator.next('override-run').runId).toBe('override-run');
    expect(generator.next().runId).toBe('default-run');
  });
});
