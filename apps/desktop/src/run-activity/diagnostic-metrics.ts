/**
 * Diagnostic metrics for desktop rendering, DOM subtree density, and memory boundaries.
 * Used during development, regression tests, and telemetry to verify memory plateau invariants.
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

const textEncoder = new TextEncoder();

class MetricsCollector {
  private activeHighlightRequests = 0;
  private highlightCacheBytes = 0;

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
