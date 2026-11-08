import { describe, expect, it } from 'vitest';
import type { DesktopMemoryObservabilitySnapshot } from '@piwin/contracts';
import { DesktopMemoryReportStore } from './desktop-memory-report-store.js';

const snapshot = (pendingSampleId?: number): DesktopMemoryObservabilitySnapshot => ({
  samples: [],
  purgeResults: [],
  stalledTicks: 0,
  ...(pendingSampleId === undefined ? {} : { pendingSampleId }),
});

describe('DesktopMemoryReportStore', () => {
  it('reports null before the first report arrives', () => {
    const store = new DesktopMemoryReportStore();
    expect(store.latest()).toBeNull();
    expect(store.diagnostics()).toBeNull();
  });

  it('keeps the latest snapshot and stamps the capture time', () => {
    const store = new DesktopMemoryReportStore();
    store.recordSnapshot(snapshot(7), 1_700_000_000_000);
    expect(store.latest()).toEqual(snapshot(7));
    expect(store.diagnostics()).toEqual({
      capturedAtMs: 1_700_000_000_000,
      snapshot: snapshot(7),
    });
  });

  it('defaults capturedAtMs to now when the reporter omits it', () => {
    const store = new DesktopMemoryReportStore();
    const before = Date.now();
    store.recordSnapshot(snapshot());
    const diagnostics = store.diagnostics();
    expect(diagnostics?.capturedAtMs).toBeGreaterThanOrEqual(before);
    expect(diagnostics?.capturedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it('retains frontend counters alongside the snapshot', () => {
    const store = new DesktopMemoryReportStore();
    store.recordSnapshot(snapshot(1), 42, { renderCommits: 3 });
    expect(store.diagnostics()).toEqual({
      capturedAtMs: 42,
      snapshot: snapshot(1),
      frontend: { renderCommits: 3 },
    });
  });

  it('replaces the previous report wholesale', () => {
    const store = new DesktopMemoryReportStore();
    store.recordSnapshot(snapshot(1), 1, { renderCommits: 1 });
    store.recordSnapshot(snapshot(2), 2);
    expect(store.diagnostics()).toEqual({ capturedAtMs: 2, snapshot: snapshot(2) });
  });
});
