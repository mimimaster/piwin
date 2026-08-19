/**
 * Browser workbench panel (ADR 0020 §6, ADR 0057).
 *
 * Mirrors Host Chromium via `browser/frame`. Default mode is Interact
 * (pointer/IME forwarded as `browser/input`). Pick remains a modifier that
 * attaches a composer chip. Controller lock comes from `browser/controller`,
 * not from whether the LLM is streaming.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type WheelEvent,
} from 'react';
import type {
  BrowserController,
  BrowserInputEvent,
  HostServerMessage,
  WebElementPickResult,
} from '@piwin/contracts';
import type { HostClient } from './host-client';
import { normalizeUrl } from './normalize-url';
import { IconBrowser, IconClose, IconRefresh } from './shell-icons';
import {
  BrowserConsoleDrawer,
  capConsoleLines,
  capNetworkLines,
  type BrowserConsoleLine,
  type BrowserNetworkLine,
} from './browser-console-drawer';
import {
  compositionEndToInsertText,
  keyEventToBrowserInput,
  pasteToInsertText,
} from './browser-workbench-ime';
import { viewportFromDisplay } from './browser-workbench-pointer';

export type BrowserSessionPanelProps = {
  hostClient: HostClient;
  onAddWebElement: (pick: WebElementPickResult) => void;
};

type FrameState = {
  src: string;
  viewportWidth: number;
  viewportHeight: number;
};

type HighlightBox = { x: number; y: number; width: number; height: number };

const PICK_FAILED_MESSAGE = 'Could not resolve element. Please try again.';
const MIRROR_START_FAILED_MESSAGE = 'Could not start the browser mirror.';
const MIRROR_STOP_FAILED_MESSAGE = 'Could not stop the browser mirror.';

export function BrowserSessionPanel(props: BrowserSessionPanelProps): ReactElement {
  const { hostClient, onAddWebElement } = props;
  const [frame, setFrame] = useState<FrameState>({ src: '', viewportWidth: 0, viewportHeight: 0 });
  const [urlInput, setUrlInput] = useState('');
  const [title, setTitle] = useState('');
  const [pickMode, setPickMode] = useState(false);
  const [highlight, setHighlight] = useState<HighlightBox | null>(null);
  const [pickPending, setPickPending] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const [owner, setOwner] = useState<BrowserController>('idle');
  const [agentWantsLock, setAgentWantsLock] = useState(false);
  const [consoleLines, setConsoleLines] = useState<BrowserConsoleLine[]>([]);
  const [networkLines, setNetworkLines] = useState<BrowserNetworkLine[]>([]);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imeRef = useRef<HTMLTextAreaElement>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const agentOwns = owner === 'agent';

  useEffect(() => {
    let cancelled = false;
    const mirrorLeaseId = crypto.randomUUID();
    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (cancelled) return;
      if (message.type === 'browser/frame') {
        setFrame({
          src: message.dataUrl,
          viewportWidth: message.width,
          viewportHeight: message.height,
        });
      } else if (message.type === 'browser/state') {
        setUrlInput(message.url ?? '');
        setTitle(message.title ?? '');
      } else if (message.type === 'browser/picked') {
        setPickPending(false);
        setPickError(null);
        setHighlight(message.result.boundingRect);
        onAddWebElement(message.result);
      } else if (message.type === 'browser/controller') {
        setOwner(message.owner);
        setAgentWantsLock(message.agentWantsLock === true);
      } else if (message.type === 'browser/console') {
        setConsoleLines((current) =>
          capConsoleLines([...current, { level: message.level, text: message.text, ts: message.ts }]),
        );
      } else if (message.type === 'browser/network') {
        setNetworkLines((current) =>
          capNetworkLines([
            ...current,
            {
              method: message.method,
              url: message.url,
              status: message.status,
              duration: message.duration,
              ts: message.ts,
            },
          ]),
        );
      }
    });

    void hostClient
      .browserStart(mirrorLeaseId)
      .then((response) => {
        if (!cancelled && !response.success) setMirrorError(MIRROR_START_FAILED_MESSAGE);
      })
      .catch(() => {
        if (!cancelled) setMirrorError(MIRROR_START_FAILED_MESSAGE);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      void hostClient
        .browserStop(mirrorLeaseId)
        .then((response) => {
          if (!response.success) setMirrorError(MIRROR_STOP_FAILED_MESSAGE);
        })
        .catch(() => {
          setMirrorError(MIRROR_STOP_FAILED_MESSAGE);
        });
    };
  }, [hostClient, onAddWebElement]);

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  const toViewport = useCallback(
    (displayX: number, displayY: number): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img || frame.viewportWidth === 0) return null;
      return viewportFromDisplay({
        displayX,
        displayY,
        displayWidth: img.clientWidth,
        displayHeight: img.clientHeight,
        viewportWidth: frame.viewportWidth,
        viewportHeight: frame.viewportHeight,
      });
    },
    [frame.viewportWidth, frame.viewportHeight],
  );

  const sendInput = useCallback(
    (events: BrowserInputEvent[]): void => {
      if (agentOwns || events.length === 0) return;
      void hostClient.browserInput(events);
    },
    [agentOwns, hostClient],
  );

  const viewportFromMouse = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      return toViewport(event.clientX - rect.left, event.clientY - rect.top);
    },
    [toViewport],
  );

  const sendClick = useCallback(
    (viewport: { x: number; y: number }, button: 'left' | 'right', clickCount = 1): void => {
      sendInput([
        {
          type: 'mouse',
          action: 'down',
          x: viewport.x,
          y: viewport.y,
          button,
          ...(clickCount > 1 ? { clickCount } : {}),
        },
        {
          type: 'mouse',
          action: 'up',
          x: viewport.x,
          y: viewport.y,
          button,
          ...(clickCount > 1 ? { clickCount } : {}),
        },
      ]);
    },
    [sendInput],
  );

  const handleNavigate = useCallback(
    async (event?: FormEvent): Promise<void> => {
      event?.preventDefault();
      if (agentOwns) return;
      const normalized = normalizeUrl(urlInput);
      if (!normalized) return;
      setUrlInput(normalized);
      await hostClient.browserNavigate(normalized);
    },
    [agentOwns, hostClient, urlInput],
  );

  const handleImageClick = useCallback(
    async (event: MouseEvent<HTMLImageElement>): Promise<void> => {
      if (agentOwns) return;
      const viewport = viewportFromMouse(event);
      if (!viewport) return;
      if (pickMode) {
        setPickPending(true);
        setPickError(null);
        setHighlight(null);
        try {
          const response = await hostClient.browserPickAt(viewport.x, viewport.y);
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
        return;
      }
      sendClick(viewport, 'left');
      imeRef.current?.focus();
    },
    [agentOwns, pickMode, viewportFromMouse, hostClient, sendClick],
  );

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLImageElement>): void => {
      if (agentOwns || pickMode) return;
      event.preventDefault();
      const viewport = viewportFromMouse(event);
      if (!viewport) return;
      sendClick(viewport, 'left', 2);
    },
    [agentOwns, pickMode, viewportFromMouse, sendClick],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLImageElement>): void => {
      if (agentOwns || pickMode) return;
      event.preventDefault();
      const viewport = viewportFromMouse(event);
      if (!viewport) return;
      sendClick(viewport, 'right');
    },
    [agentOwns, pickMode, viewportFromMouse, sendClick],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLImageElement>): void => {
      if (agentOwns || pickMode) return;
      const viewport = viewportFromMouse(event);
      if (!viewport) return;
      pendingMoveRef.current = viewport;
      if (moveRafRef.current !== null) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const next = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (next) sendInput([{ type: 'mouse', action: 'move', x: next.x, y: next.y }]);
      });
    },
    [agentOwns, pickMode, viewportFromMouse, sendInput],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLImageElement>): void => {
      if (agentOwns || pickMode) return;
      event.preventDefault();
      const viewport = viewportFromMouse(event);
      if (!viewport) return;
      sendInput([
        {
          type: 'mouse',
          action: 'wheel',
          x: viewport.x,
          y: viewport.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        },
      ]);
    },
    [agentOwns, pickMode, viewportFromMouse, sendInput],
  );

  const handleImeKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      const decision = keyEventToBrowserInput({
        type: event.type === 'keyup' ? 'keyup' : 'keydown',
        key: event.key,
        isComposing: event.nativeEvent.isComposing,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      });
      if (decision === 'ignore') return;
      event.preventDefault();
      if (decision === 'prevent-and-ignore') return;
      sendInput(decision);
    },
    [sendInput],
  );

  let overlay: HighlightBox | null = null;
  if (highlight && imgRef.current && frame.viewportWidth > 0) {
    const scale = imgRef.current.clientWidth / frame.viewportWidth;
    overlay = {
      x: highlight.x * scale,
      y: highlight.y * scale,
      width: highlight.width * scale,
      height: highlight.height * scale,
    };
  }
  let overlayOffsetX = 0;
  let overlayOffsetY = 0;
  if (overlay && imgRef.current && containerRef.current) {
    const imgRect = imgRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    overlayOffsetX = imgRect.left - containerRect.left;
    overlayOffsetY = imgRect.top - containerRect.top;
  }

  return (
    <div className="browser-session-panel" data-testid="browser-session-panel">
      <form className="browser-session-urlbar" onSubmit={handleNavigate}>
        <IconBrowser width={14} height={14} className="browser-session-urlbar-icon" />
        <input
          className="browser-session-url-input"
          data-testid="browser-session-url-input"
          type="text"
          value={urlInput}
          disabled={agentOwns}
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
        <button type="submit" className="browser-session-go-btn" data-testid="browser-session-go-btn" aria-label="Navigate" disabled={agentOwns}>
          Go
        </button>
        <button type="button" className="browser-session-refresh-btn" onClick={() => void handleNavigate()} aria-label="Reload" title="Reload" disabled={agentOwns}>
          <IconRefresh width={14} height={14} />
        </button>
      </form>

      {agentOwns ? (
        <div className="browser-session-banner" data-testid="browser-session-agent-banner">
          <span>Agent is using the browser</span>
          <button type="button" data-testid="browser-session-take-over" onClick={() => void hostClient.browserLock('user')}>
            Take over
          </button>
        </div>
      ) : null}
      {owner === 'user' ? (
        <div className="browser-session-banner user" data-testid="browser-session-user-banner">
          <span>You have control</span>
          <button type="button" data-testid="browser-session-give-back" onClick={() => void hostClient.browserUnlock('user')}>
            {agentWantsLock ? 'Give back' : 'Release'}
          </button>
        </div>
      ) : null}

      <div className="browser-session-toolbar">
        <button
          type="button"
          className={`browser-session-pick-toggle${pickMode ? ' active' : ''}`}
          data-testid="browser-session-pick-toggle"
          onClick={() => setPickMode((current) => !current)}
          disabled={agentOwns}
          title={agentOwns ? 'Pick disabled while the agent has the browser' : pickMode ? 'Exit pick mode' : 'Pick an element to attach'}
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
        {mirrorError ? (
          <span className="browser-session-pick-error" data-testid="browser-session-mirror-error">
            {mirrorError}
          </span>
        ) : null}
        {highlight ? (
          <button type="button" className="browser-session-clear-highlight" onClick={() => setHighlight(null)} aria-label="Clear highlight">
            <IconClose width={12} height={12} />
          </button>
        ) : null}
      </div>

      <div className="browser-session-frame-container" ref={containerRef} data-testid="browser-session-frame-container">
        {frame.src ? (
          <img
            ref={imgRef}
            className={`browser-session-frame${pickMode ? ' pick-mode' : ''}`}
            data-testid="browser-session-frame"
            src={frame.src}
            alt={title || urlInput || 'Browser session'}
            onClick={handleImageClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            draggable={false}
          />
        ) : (
          <div className="browser-session-frame-placeholder">
            <IconBrowser width={32} height={32} />
            <span>Starting browser session…</span>
          </div>
        )}
        {!pickMode && !agentOwns ? (
          <textarea
            ref={imeRef}
            className="browser-session-ime"
            data-testid="browser-session-ime"
            aria-label="Browser keyboard"
            onKeyDown={handleImeKey}
            onKeyUp={handleImeKey}
            onCompositionEnd={(event) => {
              const insert = compositionEndToInsertText(event.data);
              if (insert) sendInput([insert]);
              event.currentTarget.value = '';
            }}
            onPaste={(event) => {
              event.preventDefault();
              const insert = pasteToInsertText(event.clipboardData.getData('text'));
              if (insert) sendInput([insert]);
            }}
          />
        ) : null}
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
      <BrowserConsoleDrawer consoleLines={consoleLines} networkLines={networkLines} />
    </div>
  );
}
