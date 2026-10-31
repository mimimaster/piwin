/** Host browser workbench launch/connect options under `PiwinConfig.browser`. */

export type BrowserWorkbenchConfig = {
  /** Default true. Headed Chromium is still Host-owned. */
  headless?: boolean;
  /**
   * Explicit loopback CDP HTTP/WebSocket endpoint (e.g. `http://127.0.0.1:9222`).
   * Host disconnects without closing the external browser.
   */
  cdpEndpoint?: string;
  /**
   * Browser channel to use (e.g. 'chrome', 'msedge', 'chromium').
   * If omitted, uses Host-managed Chromium.
   */
  channel?: string;
  /**
   * Chromium download/runtime variant: 'chromium' (full Chromium, anti-bot resilient)
   * or 'headless-shell' (minimal ~190MB).
   */
  variant?: 'chromium' | 'headless-shell';
  /**
   * Host-owned Chromium raster scale factor. Default 2 (Retina / HiDPI crisp text).
   * Supports 1 (standard DPI), 2 (Retina 2x), 3 (HiDPI 3x).
   */
  deviceScaleFactor?: number;
  /**
   * JPEG screencast quality (1-100). Default 90.
   */
  quality?: number;
  /**
   * Optional custom user-agent string. When omitted, a modern desktop Chrome
   * user-agent is generated based on host platform (replacing HeadlessChrome).
   */
  userAgent?: string;
  /**
   * Additional command-line flags to pass to Chromium.
   */
  args?: string[];
  /**
   * Default flags to ignore from Playwright's defaults (e.g. ['--enable-automation']).
   */
  ignoreDefaultArgs?: string[] | boolean;
  /**
   * Optional local "System One" decision engine (RLCD `/api/run-parallel`).
   * When set, the `browser_act` tool resolves an intent to a snapshot ref
   * without a main-model round trip. Absent = tool not registered.
   */
  fastDecider?: BrowserFastDeciderConfig;
};

export type BrowserFastDeciderConfig = {
  /** Loopback http base URL, e.g. `http://127.0.0.1:8000`. */
  url: string;
  /** Below this probability the choice is handed back to the main model. Default 0.7. */
  minConfidence?: number;
  /** Per-decision HTTP timeout. Default 3000. */
  timeoutMs?: number;
};
