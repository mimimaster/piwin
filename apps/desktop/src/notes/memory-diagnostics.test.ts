import { describe, expect, it, vi } from 'vitest';
import type { DesktopMemoryObservabilitySnapshot } from '@piwin/contracts';
import type { DesktopObservabilitySnapshot } from '../run-activity/diagnostic-metrics.js';
import { collectDesktopMemoryDiagnostics } from './memory-diagnostics.js';

const NATIVE_SNAPSHOT: DesktopMemoryObservabilitySnapshot = {
  samples: [{ sampleId: 7, bytes: 512 * 1024 * 1024, quality: 'full' }],
  purgeResults: [{ requestId: 1, status: 'completed', windowCount: 2 }],
  pendingSampleId: 7,
  stalledTicks: 3,
};

const FRONTEND_OBSERVABILITY: DesktopObservabilitySnapshot = {
  ingressEventsByCategory: { event: 5 },
  ingressBytesByCategory: { event: 4096 },
  appliedPushBatches: 4,
  renderCommits: 12,
  activeDecodeRequests: 1,
  activeHighlightRequests: 2,
  activeDiagramRequests: 0,
  cacheEstimates: { highlight: { entries: 30, bytes: 1024 } },
  resourceCounts: { liveSessions: 2 },
  clientQueueHighWater: { items: 9, bytes: 2048 },
  domMetrics: {
    mountedTranscriptItems: 40,
    mountedCodeLines: 120,
    renderedSourceBytes: 8192,
    highlightCacheBytes: 1024,
    activeHighlightRequests: 2,
  },
};

describe('collectDesktopMemoryDiagnostics', () => {
  it('returns null when the native snapshot is unavailable', async () => {
    const result = await collectDesktopMemoryDiagnostics({
      getNativeSnapshot: () => Promise.resolve(null),
      collectFrontendObservability: () => FRONTEND_OBSERVABILITY,
    });
    expect(result).toBeNull();
  });

  it('combines the native snapshot with frontend observability', async () => {
    const result = await collectDesktopMemoryDiagnostics({
      getNativeSnapshot: () => Promise.resolve(NATIVE_SNAPSHOT),
      collectFrontendObservability: () => FRONTEND_OBSERVABILITY,
    });
    expect(result).not.toBeNull();
    expect(result?.snapshot).toEqual(NATIVE_SNAPSHOT);
    expect(result?.frontend?.renderCommits).toBe(12);
    expect(result?.frontend?.domMetrics).toEqual(FRONTEND_OBSERVABILITY.domMetrics);
    expect(result?.capturedAtMs).toBeGreaterThan(0);
  });

  it('still reports the snapshot when frontend collection throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await collectDesktopMemoryDiagnostics({
        getNativeSnapshot: () => Promise.resolve(NATIVE_SNAPSHOT),
        collectFrontendObservability: () => {
          throw new Error('boom');
        },
      });
      expect(result?.snapshot).toEqual(NATIVE_SNAPSHOT);
      expect(result?.frontend).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
