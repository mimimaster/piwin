/**
 * S02 diagnostics reporter: combines the native memory observability snapshot
 * with the renderer-side bounded counters and pushes the bundle to the Host
 * as `desktop/report-memory-observability`. Fire-and-forget — diagnostics
 * must never break the shell, and a dead Host channel just drops a tick.
 */
import type {
  DesktopFrontendObservability,
  DesktopMemoryDiagnostics,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';
import { desktopMetrics, type DesktopObservabilitySnapshot } from '../run-activity/diagnostic-metrics.js';
import { isTauriRuntime } from '../host/host-client-transport-detect.js';
import { readProjectedHostConfig } from '../host/remote-settings-hydrate.js';
import { getMemoryObservabilitySnapshot } from './memory-observability.js';
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract.js';

/** The slice of HostClient the reporter needs; tests inject fakes. */
export type MemoryDiagnosticsHostPort = {
  supportsCommand?: (type: HostCommand['type']) => boolean;
  request: (command: HostCommand) => Promise<HostResponse>;
};

export type MemoryDiagnosticsCollectPorts = {
  getNativeSnapshot?: () => Promise<NativeMemoryObservabilitySnapshot | null>;
  collectFrontendObservability?: () => DesktopObservabilitySnapshot;
};

const REPORT_INTERVAL_MS = 60_000;

/**
 * One diagnostics bundle: native snapshot + renderer observability. Returns
 * null when the native snapshot is unavailable (non-Tauri runtime or an
 * invoke failure) so the reporter stays silent instead of reporting a
 * fabricated empty snapshot.
 */
export async function collectDesktopMemoryDiagnostics(
  ports: MemoryDiagnosticsCollectPorts = {},
): Promise<DesktopMemoryDiagnostics | null> {
  const getNativeSnapshot = ports.getNativeSnapshot ?? getMemoryObservabilitySnapshot;
  const collectFrontend =
    ports.collectFrontendObservability ?? (() => desktopMetrics.collectObservability());
  const snapshot = await getNativeSnapshot();
  if (snapshot === null) {
    return null;
  }
  let frontend: DesktopFrontendObservability | undefined;
  try {
    frontend = collectFrontend();
  } catch (error) {
    console.warn('[memory-diagnostics] frontend observability failed:', error);
  }
  return {
    capturedAtMs: Date.now(),
    snapshot,
    ...(frontend === undefined ? {} : { frontend }),
  };
}

/**
 * Interval reporter: collects a bundle and uploads it, dropping errors.
 * No-op outside Tauri. Returns the stop function.
 */
export function startMemoryDiagnosticsReporter(
  hostClient: MemoryDiagnosticsHostPort,
  intervalMs = REPORT_INTERVAL_MS,
): () => void {
  if (!isTauriRuntime()) {
    return () => {};
  }
  const tick = (): void => {
    // Honour `memory.enabled === false` on each tick: settings may change
    // between intervals and the reporter must not force a workbench reload.
    void readProjectedHostConfig(hostClient)
      .then(async (config) => {
        if (config?.memory?.enabled === false) {
          return;
        }
        const diagnostics = await collectDesktopMemoryDiagnostics();
        if (diagnostics === null) {
          return;
        }
        return hostClient.request({
          type: 'desktop/report-memory-observability',
          snapshot: diagnostics.snapshot,
          capturedAtMs: diagnostics.capturedAtMs,
          ...(diagnostics.frontend === undefined ? {} : { frontend: diagnostics.frontend }),
        });
      })
      .catch(() => {});
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
