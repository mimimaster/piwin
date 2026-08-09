/**
 * Browser Session panel (ADR 0020 §6).
 *
 * Mirrors the agent-controlled Chromium via a screenshot frame stream
 * (`browser/frame` data-URLs rendered into an `<img>`). Provides a URL bar
 * bound to `browser/state` and a pick-mode toggle: in pick mode, clicking the
 * mirrored image forwards **scaled coordinates** (screenshot px ÷ img display
 * scale → viewport CSS px, matching `ariaSnapshot` `[box=…]` units) to
 * `browser/pick-at`. On `browser/picked`, a highlight overlay is drawn by
 * scaling the `boundingRect` (viewport CSS px) back to img display px, and the
 * pick result is added to the composer as a `WebElementAttachmentRef` chip.
 *
 * Pick mode is disabled while an agent tool is running (`agentRunning` prop),
 * per ADR §6 concurrency: the shared page is a single logical resource and
 * user picks must not interleave against a mid-navigation page.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { HostClient } from './host-client';
import type { HostServerMessage, WebElementPickResult } from '@piwin/contracts';
import { normalizeUrl } from './normalize-url';
import { IconBrowser, IconClose, IconRefresh } from './shell-icons';

export type BrowserSessionPanelProps = {
  hostClient: HostClient;
  /** Called when the user picks a web element; adds a composer chip. */
  onAddWebElement: (pick: WebElementPickResult) => void;
  /** True while an agent tool/run is active — disables pick mode (ADR §6). */
  agentRunning: boolean;
};

type FrameState = {
  src: string;
  /** Natural screenshot dimensions (px) from the last `browser/frame`. */
  naturalWidth: number;
  naturalHeight: number;
};

type BrowserState = {
  url: string;
  title: string;
};

type HighlightBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** User-facing message for pick failures (mapped — never a raw host error). */
const PICK_FAILED_MESSAGE = 'Could not resolve element. Please try again.';

export function BrowserSessionPanel(props: BrowserSessionPanelProps): ReactElement {
  const { hostClient, onAddWebElement, agentRunning } = props;
  const [frame, setFrame] = useState<FrameState>({
    src: '',
    naturalWidth: 0,
    naturalHeight: 0,
  });
  const [browserState, setBrowserState] = useState<BrowserState>({
    url: '',
    title: '',
  });
  const [urlInput, setUrlInput] = useState('');
  const [pickMode, setPickMode] = useState(false);
  const [highlight, setHighlight] = useState<HighlightBox | null>(null);
  const [pickPending, setPickPending] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Subscribe to browser/* pushes and start the session on mount.
  useEffect(() => {
    let cancelled = false;
    const mirrorLeaseId = crypto.randomUUID();
    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (cancelled) return;
      if (message.type === 'browser/frame') {
        setFrame({
          src: message.dataUrl,
          naturalWidth: message.width,
          naturalHeight: message.height,
        });
      } else if (message.type === 'browser/state') {
        const nextUrl = message.url ?? '';
        const nextTitle = message.title ?? '';
        setBrowserState({ url: nextUrl, title: nextTitle });
        setUrlInput(nextUrl);
      } else if (message.type === 'browser/picked') {
        setPickPending(false);
        setPickError(null);
        const result = message.result;
        setHighlight({
          x: result.boundingRect.x,
          y: result.boundingRect.y,
          width: result.boundingRect.width,
          height: result.boundingRect.height,
        });
        onAddWebElement(result);
      }
    });

    // Acquire the mirror lease. HostRuntime keeps the BrowserSession service,
    // while this command alone owns the Chromium/frame-stream lifetime.
    void hostClient
      .browserStart(mirrorLeaseId)
      .then((response) => {
        if (!cancelled && !response.success) {
          console.warn('[piwin] browser mirror start failed', response.error);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn('[piwin] browser mirror start failed', error);
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
      // Release the mirror lease on tab switch/panel close. The Host waits for
      // Playwright's persistent context to close; agent tools can relaunch the
      // same reusable service object later.
      void hostClient
        .browserStop(mirrorLeaseId)
        .then((response) => {
          if (!response.success) {
            console.warn('[piwin] browser mirror stop failed', response.error);
          }
        })
        .catch((error: unknown) => {
          console.warn('[piwin] browser mirror stop failed', error);
        });
    };
  }, [hostClient, onAddWebElement]);

  // Disable pick mode when an agent run starts.
  useEffect(() => {
    if (agentRunning && pickMode) {
      setPickMode(false);
    }
  }, [agentRunning, pickMode]);

  const handleNavigate = useCallback(
    async (event?: React.FormEvent): Promise<void> => {
      event?.preventDefault();
      const normalized = normalizeUrl(urlInput);
      if (!normalized) return;
      setUrlInput(normalized);
      await hostClient.browserNavigate(normalized);
    },
    [hostClient, urlInput],
  );

  /**
   * Compute the scale factor between the screenshot natural size and the
   * displayed `<img>` CSS size, then convert a click point from display px
   * to viewport CSS px (the coordinate space `browser/pick-at` expects,
   * matching `ariaSnapshot` `[box=…]` units).
   */
  const computeScale = useCallback((): number => {
    const img = imgRef.current;
    if (!img || frame.naturalWidth === 0) return 1;
    return img.clientWidth / frame.naturalWidth;
  }, [frame.naturalWidth]);

  const handleImageClick = useCallback(
    async (event: React.MouseEvent<HTMLImageElement>): Promise<void> => {
      if (!pickMode || agentRunning) return;
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const displayX = event.clientX - rect.left;
      const displayY = event.clientY - rect.top;
      const scale = computeScale();
      if (scale === 0) return;
      const viewportX = Math.round(displayX / scale);
      const viewportY = Math.round(displayY / scale);
      setPickPending(true);
      setPickError(null);
      setHighlight(null);
      try {
        const response = await hostClient.browserPickAt(viewportX, viewportY);
        // The browser/picked push clears pending and sets the highlight; but if
        // the host resolves without a push (or the push is dropped) pending must
        // still clear or the "Resolving…" indicator sticks forever.
        setPickPending(false);
        if (!response.success) {
          setPickError(PICK_FAILED_MESSAGE);
          console.error('[browser-session] pick-at failed:', response.error);
        }
      } catch (error) {
        setPickPending(false);
        setPickError(PICK_FAILED_MESSAGE);
        console.error('[browser-session] pick-at failed:', error);
      }
    },
    [pickMode, agentRunning, computeScale, hostClient],
  );

  /**
   * Scale a viewport-CSS-px `boundingRect` back to img display px for the
   * overlay highlight. This is the inverse of the click coordinate scaling.
   */
  const scaledHighlight = useCallback((): HighlightBox | null => {
    if (!highlight) return null;
    const scale = computeScale();
    return {
      x: highlight.x * scale,
      y: highlight.y * scale,
      width: highlight.width * scale,
      height: highlight.height * scale,
    };
  }, [highlight, computeScale]);

  const overlay = scaledHighlight();

  // The img is centered in the frame container (flex align/justify center +
  // max-width/max-height), so when the panel's aspect ratio differs from the
  // screenshot it is letterboxed and its origin is offset from the container's.
  // The overlay is positioned relative to the container, so shift it by that
  // intra-container offset to land on the actual element. Click coordinates use
  // the same img rect (already correct) — only the overlay origin needs this.
  let overlayOffsetX = 0;
  let overlayOffsetY = 0;
  if (overlay) {
    const img = imgRef.current;
    const container = containerRef.current;
    if (img && container) {
      const imgRect = img.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      overlayOffsetX = imgRect.left - containerRect.left;
      overlayOffsetY = imgRect.top - containerRect.top;
    }
  }

  return (
    <div className="browser-session-panel" data-testid="browser-session-panel">
      {/* URL bar */}
      <form className="browser-session-urlbar" onSubmit={handleNavigate}>
        <IconBrowser width={14} height={14} className="browser-session-urlbar-icon" />
        <input
          className="browser-session-url-input"
          data-testid="browser-session-url-input"
          type="text"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          onPaste={(event: ClipboardEvent<HTMLInputElement>) => event.stopPropagation()}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleNavigate();
            }
          }}
          placeholder="Enter URL or localhost:3000"
          spellCheck={false}
        />
        <button
          type="submit"
          className="browser-session-go-btn"
          data-testid="browser-session-go-btn"
          aria-label="Navigate"
        >
          Go
        </button>
        <button
          type="button"
          className="browser-session-refresh-btn"
          onClick={() => void handleNavigate()}
          aria-label="Reload"
          title="Reload"
        >
          <IconRefresh width={14} height={14} />
        </button>
      </form>

      {/* Pick mode toggle */}
      <div className="browser-session-toolbar">
        <button
          type="button"
          className={`browser-session-pick-toggle${pickMode ? ' active' : ''}`}
          data-testid="browser-session-pick-toggle"
          onClick={() => setPickMode((current) => !current)}
          disabled={agentRunning}
          title={
            agentRunning
              ? 'Pick disabled while agent is running'
              : pickMode
                ? 'Exit pick mode'
                : 'Pick an element to attach'
          }
        >
          {pickMode ? 'Pick mode: ON' : 'Pick element'}
        </button>
        {pickPending ? (
          <span className="browser-session-pick-pending" data-testid="browser-session-pick-pending">
            Resolving element…
          </span>
        ) : null}
        {pickError ? (
          <span className="browser-session-pick-error" data-testid="browser-session-pick-error">
            {pickError}
          </span>
        ) : null}
        {highlight ? (
          <button
            type="button"
            className="browser-session-clear-highlight"
            onClick={() => setHighlight(null)}
            aria-label="Clear highlight"
          >
            <IconClose width={12} height={12} />
          </button>
        ) : null}
      </div>

      {/* Mirrored frame */}
      <div
        className="browser-session-frame-container"
        ref={containerRef}
        data-testid="browser-session-frame-container"
      >
        {frame.src ? (
          <img
            ref={imgRef}
            className={`browser-session-frame${pickMode ? ' pick-mode' : ''}`}
            data-testid="browser-session-frame"
            src={frame.src}
            alt={browserState.title || browserState.url || 'Browser session'}
            onClick={handleImageClick}
            draggable={false}
          />
        ) : (
          <div className="browser-session-frame-placeholder">
            <IconBrowser width={32} height={32} />
            <span>Starting browser session…</span>
          </div>
        )}
        {overlay ? (
          <div
            className="browser-session-highlight"
            data-testid="browser-session-highlight"
            style={{
              position: 'absolute',
              left: `${overlay.x + overlayOffsetX}px`,
              top: `${overlay.y + overlayOffsetY}px`,
              width: `${overlay.width}px`,
              height: `${overlay.height}px`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
