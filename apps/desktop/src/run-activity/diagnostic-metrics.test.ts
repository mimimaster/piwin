import { beforeEach, describe, expect, it } from 'vitest';
import { desktopMetrics, utf8ByteLength } from './diagnostic-metrics';

describe('desktopMetrics observability', () => {
  beforeEach(() => {
    desktopMetrics.resetObservability();
  });

  it('records ingress counts and bytes by category', () => {
    desktopMetrics.recordIngress('push:session/update', 100);
    desktopMetrics.recordIngress('push:session/update', 50);
    desktopMetrics.recordIngress('push:host/status', 20);

    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.ingressEventsByCategory).toEqual({
      'push:session/update': 2,
      'push:host/status': 1,
    });
    expect(snapshot.ingressBytesByCategory).toEqual({
      'push:session/update': 150,
      'push:host/status': 20,
    });
  });

  it('counts applied batches and render commits', () => {
    desktopMetrics.recordAppliedBatch();
    desktopMetrics.recordAppliedBatch();
    desktopMetrics.recordRenderCommit();
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.appliedPushBatches).toBe(2);
    expect(snapshot.renderCommits).toBe(1);
  });

  it('tracks active gauges with a floor of zero', () => {
    desktopMetrics.incrementActiveDecode();
    desktopMetrics.incrementActiveDecode();
    desktopMetrics.decrementActiveDecode();
    desktopMetrics.decrementActiveDecode();
    desktopMetrics.decrementActiveDecode();
    desktopMetrics.incrementActiveDiagram();
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.activeDecodeRequests).toBe(0);
    expect(snapshot.activeDiagramRequests).toBe(1);
  });

  it('keeps a monotonic client queue high-water mark', () => {
    desktopMetrics.setClientQueueHighWater({ items: 3, bytes: 300 });
    desktopMetrics.setClientQueueHighWater({ items: 1, bytes: 500 });
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.clientQueueHighWater).toEqual({ items: 3, bytes: 500 });
  });

  it('merges pushed and provider cache estimates', () => {
    desktopMetrics.setCacheEstimate('warmSessions', { entries: 2, bytes: 1234 });
    desktopMetrics.registerCacheProvider('testProvider', () => ({ entries: 5, bytes: 42 }));
    try {
      const snapshot = desktopMetrics.collectObservability(null);
      expect(snapshot.cacheEstimates.warmSessions).toEqual({ entries: 2, bytes: 1234 });
      expect(snapshot.cacheEstimates.testProvider).toEqual({ entries: 5, bytes: 42 });
    } finally {
      desktopMetrics.registerCacheProvider('testProvider', () => ({ entries: 0, bytes: 0 }));
    }
  });

  it('collects registered resource counts and skips failing providers', () => {
    desktopMetrics.registerResourceCountProvider('testResources', () => 7);
    desktopMetrics.registerResourceCountProvider('broken', () => {
      throw new Error('nope');
    });
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.resourceCounts.testResources).toBe(7);
    expect(snapshot.resourceCounts.broken).toBeUndefined();
  });

  it('merges DOM metrics into the snapshot', () => {
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.domMetrics).toBeDefined();
    expect(snapshot.domMetrics.mountedTranscriptItems).toBe(0);
    expect(typeof snapshot.domMetrics.highlightCacheBytes).toBe('number');
  });

  it('resetObservability clears counters but keeps registrations', () => {
    desktopMetrics.recordIngress('push:x', 1);
    desktopMetrics.recordAppliedBatch();
    desktopMetrics.setCacheEstimate('warmSessions', { entries: 1, bytes: 1 });
    desktopMetrics.registerResourceCountProvider('kept', () => 9);
    desktopMetrics.resetObservability();
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.ingressEventsByCategory).toEqual({});
    expect(snapshot.appliedPushBatches).toBe(0);
    expect(snapshot.cacheEstimates.warmSessions).toBeUndefined();
    expect(snapshot.resourceCounts.kept).toBe(9);
  });
});

describe('utf8ByteLength', () => {
  it('counts bytes not chars', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('')).toBe(0);
  });
});
