import type {
  DesktopFrontendObservability,
  DesktopMemoryDiagnostics,
  DesktopMemoryObservabilitySnapshot,
} from '@piwin/contracts';

/**
 * Latest desktop memory diagnostics the attached shell reported. Kept in
 * memory only — the bundle is a live gauge, not durable state, and the
 * `desktop/report-memory-observability` command replaces it wholesale.
 * Nothing here is surfaced to model context.
 */
export class DesktopMemoryReportStore {
  private latestReport: {
    capturedAtMs: number;
    snapshot: DesktopMemoryObservabilitySnapshot;
    frontend?: DesktopFrontendObservability;
  } | null = null;

  public recordSnapshot(
    snapshot: DesktopMemoryObservabilitySnapshot,
    capturedAtMs?: number,
    frontend?: DesktopFrontendObservability,
  ): void {
    this.latestReport = {
      capturedAtMs: capturedAtMs ?? Date.now(),
      snapshot,
      ...(frontend === undefined ? {} : { frontend }),
    };
  }

  /** Latest native observability snapshot, or null before the first report. */
  public latest(): DesktopMemoryObservabilitySnapshot | null {
    return this.latestReport?.snapshot ?? null;
  }

  /** The full diagnostics bundle, or null before the first report. */
  public diagnostics(): DesktopMemoryDiagnostics | null {
    const report = this.latestReport;
    if (report === null) {
      return null;
    }
    return {
      capturedAtMs: report.capturedAtMs,
      snapshot: report.snapshot,
      ...(report.frontend === undefined ? {} : { frontend: report.frontend }),
    };
  }
}
