import { describe, expect, it } from 'vitest';
import { isInstructionDeliveryNewer } from './instruction-delivery-order';

const intervention = (revision: number) => ({
  kind: 'run-intervention' as const,
  instructionId: 'i1',
  status: 'pending' as const,
  revision,
});
const queuedTurn = (revision: number) => ({
  kind: 'queued-turn' as const,
  instructionId: 'q1',
  status: 'pending' as const,
  revision,
});

describe('isInstructionDeliveryNewer', () => {
  it('orders one instruction by revision, ties to the incoming copy', () => {
    expect(isInstructionDeliveryNewer(intervention(3), intervention(1))).toBe(true);
    expect(isInstructionDeliveryNewer(intervention(1), intervention(3))).toBe(false);
    expect(isInstructionDeliveryNewer(intervention(2), intervention(2))).toBe(true);
  });

  it('treats send-now conversion as one-way from queued turn to intervention', () => {
    expect(isInstructionDeliveryNewer(intervention(1), queuedTurn(2))).toBe(true);
    expect(isInstructionDeliveryNewer(queuedTurn(2), intervention(1))).toBe(false);
  });
});
