/**
 * Wire contract for the desktop memory observability pipeline (S00 baseline).
 * These types mirror the payload shapes emitted by the Tauri native memory
 * monitor and purge path; they carry data only — classification, budgets and
 * enforcement policy live in the app. Field names match the serde camelCase
 * spellings; optional fields are absent (never null, never 0-bytes) when the
 * platform could not sample them.
 */

/** Whether a sampled process belongs to the main window or an auxiliary webview. */
export type DesktopMemoryProcessRole = 'main' | 'auxiliary';

/** One attributed process sample for a desktop window. */
export type DesktopMemoryProcessSample = {
  /** Tauri window label this process serves. */
  windowLabel: string;
  /** Main-window process or an auxiliary (pinned/overlay) webview. */
  role: DesktopMemoryProcessRole;
  /** OS pid of the WebContent/webview process, when the platform SPI resolved it. */
  pid?: number;
  /** u64 mach absolute time serialized as a decimal string (JS precision). */
  startClock?: string;
  /** Resident memory footprint in bytes; absent when unfetchable. */
  footprintBytes?: number;
  /** True when >1 live window maps the same WebContent pid. */
  shared: boolean;
};

/** App-owned pressure tier attached to a sample (`level`). */
export type DesktopMemoryPressureLevel = 'normal' | 'moderate' | 'critical';

/** OS-reported memory pressure tier (`osPressure`). */
export type DesktopMemoryOsPressureLevel = 'normal' | 'warning' | 'urgent' | 'critical';

/** Kind of per-window sampling failure reported by the native monitor. */
export type DesktopMemorySampleErrorKind = 'webview-pid' | 'footprint' | 'os-pressure';

/** One sampling failure: which probe failed, optionally on which window, and why. */
export type DesktopMemorySampleError = {
  /** Which probe failed. */
  kind: DesktopMemorySampleErrorKind;
  /** Window label when the failure is window-scoped. */
  windowLabel?: string;
  /** Human-readable failure description. */
  message: string;
};

/** A process that exited since the previous sample (retained for attribution). */
export type DesktopMemoryRetiredProcess = {
  /** OS pid that exited. */
  pid: number;
  /** Mach absolute start clock as decimal string, when captured. */
  startClock?: string;
  /** Window label the process last served. */
  lastWindowLabel: string;
  /** Last observed footprint in bytes, when captured. */
  lastFootprintBytes?: number;
};

/** How complete a sample is: all probes OK, partially sampled, or unavailable. */
export type DesktopMemorySampleQuality = 'full' | 'partial' | 'unavailable';

/**
 * Payload of the native `desktop:memory-pressure` event. `bytes`,
 * `availableBytes` and `level` keep their legacy meaning; everything else is
 * additive observability emitted by the S00 monitor baseline.
 */
export type DesktopMemoryPressureSample = {
  /** Legacy main-window footprint in bytes. */
  bytes?: number;
  /** Estimated reclaimable memory in bytes, when the OS reports it. */
  availableBytes?: number;
  /** Interpretation of `availableBytes` (`reclaimable-estimate`). */
  availableBytesKind?: 'reclaimable-estimate';
  /** App-owned pressure tier. */
  level?: DesktopMemoryPressureLevel;
  /** Monotonic sample id used to ack-gate processing. */
  sampleId?: number;
  /** Wall-clock capture time (ms since epoch). */
  timestampMs?: number;
  /** Monotonic capture clock in ms. */
  monotonicMs?: number;
  /** App version that produced the sample. */
  appVersion?: string;
  /** OS-reported pressure tier. */
  osPressure?: DesktopMemoryOsPressureLevel;
  /** Summed footprint across all attributed processes. */
  aggregateFootprintBytes?: number;
  /** Per-window process attribution. */
  processes?: DesktopMemoryProcessSample[];
  /** Processes that exited since the previous sample. */
  retiredProcesses?: DesktopMemoryRetiredProcess[];
  /** Live window labels that could not be attributed to a process. */
  unknownWindows?: string[];
  /** Per-probe sampling failures encountered while building this sample. */
  errors?: DesktopMemorySampleError[];
  /** Sample completeness. */
  quality?: DesktopMemorySampleQuality;
};

/** Outcome status of a `desktop:memory-purge` lifecycle event. */
export type DesktopMemoryPurgeStatus = 'requested' | 'completed' | 'timeout' | 'unavailable';

/** Payload of a `desktop:memory-purge` lifecycle event. */
export type DesktopMemoryPurgeResult = {
  /** Purge request id this result resolves. */
  requestId: number;
  /** Terminal/interim purge status. */
  status: DesktopMemoryPurgeStatus;
  /** Number of windows the purge was applied to. */
  windowCount: number;
  /** Failure description when the purge could not run. */
  error?: string;
};

/** Return shape of the native `memory_observability_snapshot` command. */
export type DesktopMemoryObservabilitySnapshot = {
  /** Retained recent pressure samples. */
  samples: DesktopMemoryPressureSample[];
  /** Retained recent purge lifecycle results. */
  purgeResults: DesktopMemoryPurgeResult[];
  /** Sample id awaiting client ack, when one is in flight. */
  pendingSampleId?: number;
  /** Count of monitor ticks that stalled without producing a sample. */
  stalledTicks: number;
};

/** Client-side memory-reclamation settings (defaults live in the app). */
export type DesktopMemorySettings = {
  /** Master switch for memory observability/reclamation. */
  enabled: boolean;
  /** `observe` records diagnostics only; `enforce` applies purges/budgets. */
  mode: 'observe' | 'enforce';
  /** Aggregate footprint budget in bytes. */
  budgetBytes?: number;
  /** Bytes to reclaim when over budget. */
  reclaimTargetBytes?: number;
  /** Native sampling cadence in seconds. */
  captureIntervalSeconds?: number;
  /** Session retention cap for in-memory reclamation. */
  maxSessionsInMemory?: number;
  /** Transcript retention cap per session for in-memory reclamation. */
  maxTranscriptItemsPerSession?: number;
};

/**
 * Frontend (renderer-side) observability attached to a diagnostics bundle.
 * Mirrors the desktop `collectObservability()` counters — every field is
 * optional because the collector evolves independently and a missing gauge
 * is informational, never an error.
 */
export type DesktopFrontendObservability = {
  /** Ingress push/event counts by category. */
  ingressEventsByCategory?: Record<string, number>;
  /** Ingress serialized byte totals by category. */
  ingressBytesByCategory?: Record<string, number>;
  /** Push batches applied to subscribers. */
  appliedPushBatches?: number;
  /** Committed render passes observed by the frontend profiler. */
  renderCommits?: number;
  /** In-flight decode/highlight/diagram work gauges. */
  activeDecodeRequests?: number;
  activeHighlightRequests?: number;
  activeDiagramRequests?: number;
  /** Cache estimates (entries + bytes) by cache name. */
  cacheEstimates?: Record<string, { entries: number; bytes: number }>;
  /** Integer resource gauges by name. */
  resourceCounts?: Record<string, number>;
  /** Client-side queue high-water mark. */
  clientQueueHighWater?: { items: number; bytes: number };
  /** DOM subtree density metrics (mounted items/lines/bytes). */
  domMetrics?: Record<string, number>;
};

/**
 * Diagnostics bundle for the memory pipeline: the latest native
 * observability snapshot plus optional frontend observability counters.
 */
export type DesktopMemoryDiagnostics = {
  /** Wall-clock time (ms since epoch) the diagnostics bundle was captured. */
  capturedAtMs: number;
  /** Latest native observability snapshot. */
  snapshot: DesktopMemoryObservabilitySnapshot;
  /** Renderer-side observability counters, when the reporter included them. */
  frontend?: DesktopFrontendObservability;
};
