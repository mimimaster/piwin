/**
 * Diagnostic metrics for desktop rendering, DOM subtree density, and memory boundaries.
 * Used during development, regression tests, and telemetry to verify memory plateau invariants.
 *
 * S00 observability: `collectObservability()` snapshots the bounded counters and
 * registered cache/resource providers so diagnostics can correlate Host ingress,
 * render churn, and resident caches without touching payload content.
 */

export type DesktopRenderMetrics = {
  /** Number of transcript items currently mounted in the DOM. */
  mountedTranscriptItems: number;
  /** Number of rendered code lines (<div className="md-code-line"> / code-preview rows). */
  mountedCodeLines: number;
  /** Estimated bytes of raw code/text currently mounted in the DOM. */
  renderedSourceBytes: number;
  /** Estimated bytes held in syntax highlight caches. */
  highlightCacheBytes: number;
  /** Active in-flight syntax highlight requests. */
  activeHighlightRequests: number;
};

export type CacheEstimate = { entries: number; bytes: number };

export type ClientQueueHighWater = { items: number; bytes: number };

/**
 * Bounded observability snapshot (no payload content): ingress counts and
 * byte totals by message category, applied batch/render counters, in-flight
 * work gauges, and registered cache/resource estimates.
 */
export type DesktopObservabilitySnapshot = {
  ingressEventsByCategory: Record<string, number>;
  ingressBytesByCategory: Record<string, number>;
  appliedPushBatches: number;
  renderCommits: number;
  activeDecodeRequests: number;
  activeHighlightRequests: number;
  activeDiagramRequests: number;
  cacheEstimates: Record<string, CacheEstimate>;
  resourceCounts: Record<string, number>;
  clientQueueHighWater: ClientQueueHighWater;
  /** DOM subtree density merged from collectDomMetrics. */
  domMetrics: DesktopRenderMetrics;
};

const textEncoder = new TextEncoder();

/** UTF-8 byte length of an already-stringified value. */
export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

type CacheProvider = () => CacheEstimate;
type ResourceCountProvider = () => number;

class MetricsCollector {
  private activeHighlightRequests = 0;
  private highlightCacheBytes = 0;

  private ingressEventsByCategory = new Map<string, number>();
  private ingressBytesByCategory = new Map<string, number>();
  private appliedPushBatches = 0;
  private renderCommits = 0;
  private activeDecodeRequests = 0;
  private activeDiagramRequests = 0;
  private clientQueueHighWater: ClientQueueHighWater = { items: 0, bytes: 0 };

  private pushedCacheEstimates = new Map<string, CacheEstimate>();
  private cacheProviders = new Map<string, CacheProvider>();
  private resourceCountProviders = new Map<string, ResourceCountProvider>();

  public incrementHighlightRequests(): void {
    this.activeHighlightRequests += 1;
  }

  public decrementHighlightRequests(): void {
    this.activeHighlightRequests = Math.max(0, this.activeHighlightRequests - 1);
  }

  public setHighlightCacheBytes(bytes: number): void {
    this.highlightCacheBytes = Math.max(0, bytes);
  }

  public getHighlightCacheBytes(): number {
    return this.highlightCacheBytes;
  }

  public getActiveHighlightRequests(): number {
    return this.activeHighlightRequests;
  }

  /** Count one ingress message and its serialized byte cost by category. */
  public recordIngress(category: string, bytes: number): void {
    this.ingressEventsByCategory.set(
      category,
      (this.ingressEventsByCategory.get(category) ?? 0) + 1,
    );
    this.ingressBytesByCategory.set(
      category,
      (this.ingressBytesByCategory.get(category) ?? 0) + Math.max(0, bytes),
    );
  }

  /** One `host-message-batch` frame applied to subscribers. */
  public recordAppliedBatch(): void {
    this.appliedPushBatches += 1;
  }

  /** One committed render pass observed by a caller-side profiler. */
  public recordRenderCommit(): void {
    this.renderCommits += 1;
  }

  public incrementActiveDecode(): void {
    this.activeDecodeRequests += 1;
  }

  public decrementActiveDecode(): void {
    this.activeDecodeRequests = Math.max(0, this.activeDecodeRequests - 1);
  }

  public incrementActiveDiagram(): void {
    this.activeDiagramRequests += 1;
  }

  public decrementActiveDiagram(): void {
    this.activeDiagramRequests = Math.max(0, this.activeDiagramRequests - 1);
  }

  /**
   * High-water mark for a client-side queue. Only raises the mark; the
   * reset path is `resetObservability`.
   */
  public setClientQueueHighWater(mark: { items: number; bytes: number }): void {
    this.clientQueueHighWater = {
      items: Math.max(this.clientQueueHighWater.items, Math.max(0, mark.items)),
      bytes: Math.max(this.clientQueueHighWater.bytes, Math.max(0, mark.bytes)),
    };
  }

  /**
   * Push path for caches without a module-scope instance the collector can
   * pull from (e.g. the reducer-owned warm-session cache). Last write wins.
   */
  public setCacheEstimate(name: string, estimate: CacheEstimate): void {
    this.pushedCacheEstimates.set(name, {
      entries: Math.max(0, estimate.entries),
      bytes: Math.max(0, estimate.bytes),
    });
  }

  /** Pull path: `provider` runs on each `collectObservability()` call. */
  public registerCacheProvider(name: string, provider: CacheProvider): void {
    this.cacheProviders.set(name, provider);
  }

  /** Pull path for integer gauges like live resource registrations. */
  public registerResourceCountProvider(name: string, provider: ResourceCountProvider): void {
    this.resourceCountProviders.set(name, provider);
  }

  private collectCacheEstimates(): Record<string, CacheEstimate> {
    const estimates: Record<string, CacheEstimate> = {};
    for (const [name, estimate] of this.pushedCacheEstimates) {
      estimates[name] = estimate;
    }
    for (const [name, provider] of this.cacheProviders) {
      try {
        const estimate = provider();
        estimates[name] = {
          entries: Math.max(0, estimate.entries),
          bytes: Math.max(0, estimate.bytes),
        };
      } catch (error) {
        console.warn('[diagnostic-metrics] cache provider failed:', name, error);
      }
    }
    return estimates;
  }

  private collectResourceCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [name, provider] of this.resourceCountProviders) {
      try {
        counts[name] = Math.max(0, provider());
      } catch (error) {
        console.warn('[diagnostic-metrics] resource provider failed:', name, error);
      }
    }
    return counts;
  }

  /** One observability snapshot; providers run here so numbers stay fresh. */
  public collectObservability(rootElement?: Element | null): DesktopObservabilitySnapshot {
    return {
      ingressEventsByCategory: Object.fromEntries(this.ingressEventsByCategory),
      ingressBytesByCategory: Object.fromEntries(this.ingressBytesByCategory),
      appliedPushBatches: this.appliedPushBatches,
      renderCommits: this.renderCommits,
      activeDecodeRequests: this.activeDecodeRequests,
      activeHighlightRequests: this.activeHighlightRequests,
      activeDiagramRequests: this.activeDiagramRequests,
      cacheEstimates: this.collectCacheEstimates(),
      resourceCounts: this.collectResourceCounts(),
      clientQueueHighWater: { ...this.clientQueueHighWater },
      domMetrics: this.collectDomMetrics(rootElement),
    };
  }

  /**
   * Zero the observability counters and pushed estimates. Registered
   * providers and the highlight gauges are retained — registrations are
   * module-level, and active highlight work is owned by its callers.
   */
  public resetObservability(): void {
    this.ingressEventsByCategory.clear();
    this.ingressBytesByCategory.clear();
    this.appliedPushBatches = 0;
    this.renderCommits = 0;
    this.activeDecodeRequests = 0;
    this.activeDiagramRequests = 0;
    this.clientQueueHighWater = { items: 0, bytes: 0 };
    this.pushedCacheEstimates.clear();
  }

  public collectDomMetrics(rootElement?: Element | null): DesktopRenderMetrics {
    const root = rootElement ?? (typeof document !== 'undefined' ? document.querySelector('.chat-stream') : null);
    if (!root) {
      return {
        mountedTranscriptItems: 0,
        mountedCodeLines: 0,
        renderedSourceBytes: 0,
        highlightCacheBytes: this.highlightCacheBytes,
        activeHighlightRequests: this.activeHighlightRequests,
      };
    }

    const transcriptItems = root.querySelectorAll(
      '[data-testid="chat-message-row"], [data-testid="tool-call-card"], .transcript-turn, .transcript-turn-window-item',
    );
    const codeLines = root.querySelectorAll('.md-code-line, .code-preview-row, .diff-line');

    let sourceBytes = 0;
    // Query top-level pre elements and standalone code elements to prevent double-counting
    const codeBlocks = root.querySelectorAll('pre, code:not(pre code)');
    codeBlocks.forEach((block) => {
      const text = block.textContent ?? '';
      sourceBytes += textEncoder.encode(text).byteLength;
    });

    return {
      mountedTranscriptItems: transcriptItems.length,
      mountedCodeLines: codeLines.length,
      renderedSourceBytes: sourceBytes,
      highlightCacheBytes: this.highlightCacheBytes,
      activeHighlightRequests: this.activeHighlightRequests,
    };
  }
}

export const desktopMetrics = new MetricsCollector();
