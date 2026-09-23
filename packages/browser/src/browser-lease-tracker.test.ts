import { describe, expect, it } from 'vitest';
import { createBrowserLeaseTracker } from './browser-lease-tracker.js';

describe('createBrowserLeaseTracker', () => {
  it('tracks legacy unnamed leases', () => {
    const tracker = createBrowserLeaseTracker();
    expect(tracker.hasActiveMirrorLease()).toBe(false);
    expect(tracker.mirrorLeaseCount()).toBe(0);

    expect(tracker.acquireMirrorLease()).toBe(true);
    expect(tracker.hasActiveMirrorLease()).toBe(true);
    expect(tracker.mirrorLeaseCount()).toBe(1);

    expect(tracker.releaseMirrorLease()).toBe(true);
    expect(tracker.hasActiveMirrorLease()).toBe(false);
    expect(tracker.mirrorLeaseCount()).toBe(0);
  });

  it('tracks named leases independently and prevents resurrection of tombstoned leases', () => {
    const tracker = createBrowserLeaseTracker();
    expect(tracker.acquireMirrorLease('lease-1')).toBe(true);
    expect(tracker.acquireMirrorLease('lease-2')).toBe(true);
    expect(tracker.mirrorLeaseCount()).toBe(2);
    expect(tracker.hasMirrorLease('lease-1')).toBe(true);
    expect(tracker.hasMirrorLease('lease-2')).toBe(true);

    expect(tracker.releaseMirrorLease('lease-1')).toBe(false);
    expect(tracker.hasMirrorLease('lease-1')).toBe(false);
    expect(tracker.hasActiveMirrorLease()).toBe(true);

    // Released lease cannot be resurrected
    expect(tracker.acquireMirrorLease('lease-1')).toBe(false);

    // Releasing last lease returns true
    expect(tracker.releaseMirrorLease('lease-2')).toBe(true);
    expect(tracker.hasActiveMirrorLease()).toBe(false);
  });

  it('lets a lease released on disconnect be acquired again', () => {
    const tracker = createBrowserLeaseTracker();
    tracker.acquireMirrorLease('lease-1');

    expect(tracker.releaseMirrorLease('lease-1', { retire: false })).toBe(true);
    expect(tracker.mirrorLeaseCount()).toBe(0);
    expect(tracker.acquireMirrorLease('lease-1')).toBe(true);
    expect(tracker.hasMirrorLease('lease-1')).toBe(true);
  });

  it('validates lease ID bounds', () => {
    const tracker = createBrowserLeaseTracker();
    expect(() => tracker.acquireMirrorLease('')).toThrow(RangeError);
    expect(() => tracker.acquireMirrorLease('a'.repeat(129))).toThrow(RangeError);
  });

  it('clears all leases', () => {
    const tracker = createBrowserLeaseTracker();
    tracker.acquireMirrorLease('lease-1');
    tracker.acquireMirrorLease();
    expect(tracker.mirrorLeaseCount()).toBe(2);

    tracker.clearLeases();
    expect(tracker.mirrorLeaseCount()).toBe(0);
    expect(tracker.hasActiveMirrorLease()).toBe(false);
  });
});
