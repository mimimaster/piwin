/**
 * Browser workbench panel (ADR 0020 §6, ADR 0057).
 *
 * Mirrors Host Chromium via `browser/frame`. Default mode is Interact
 * (pointer/IME forwarded as `browser/input`). Pick remains a modifier that
 * attaches a composer chip. `browser/controller` is only an activity indicator:
 * the human and the agent share the page and neither locks the other out,
 * not from whether the LLM is streaming.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from './host-client';
import { normalizeUrl } from './normalize-url';
import { IconClose } from './shell-icons';
import { BrowserSessionChrome } from './browser-session-chrome';
import { BrowserConsoleDrawer } from './browser-console-drawer';
import { BrowserViewportSurface } from './browser-viewport-surface';
import {
  useBrowserSessionLease,
  type BrowserHighlightBox,
} from './browser-session-lease';
import { resolveBrowserRuntimeStatus } from './browser-runtime-status';
import {
  compositionEndToInsertText,
  keyEventToBrowserInput,
  pasteToInsertText,
} from './browser-workbench-ime';
import { displayRectFromFilledViewport } from './browser-workbench-pointer';
import { useBrowserInput } from './hooks/use-browser-input';
import { BrowserAnnotationOverlay } from './browser-annotation-overlay';
import { useDesktopLocale } from './desktop-locale-context';
import { openExternalUrl } from './open-external-url';
import type { BrowserPanelNotice } from './browser-session-chrome';
import { browserSessionCopy } from './browser-session-copy';
import { formatBrowserDensityRatio, resolveBrowserMirrorDensity } from './browser-mirror-density';
import {
  resolveBrowserDisplayBox,
  type BrowserDisplayZoom,
} from './browser-display-box';
import {
  BROWSER_VIEWPORT_MENU_PRESETS,
  resolveFollowViewportBox,
  resolveViewportPresetId,
  useBrowserViewport,
  type BrowserViewportPresetId,
} from './hooks/use-browser-viewport';
import { loadBrowserViewportPreference, saveBrowserViewportPreference } from './ui-preferences';

export type BrowserSessionPanelProps = {
  hostClient: HostClient;
  onAddWebElement: (pick: WebElementPickResult) => void;
  onAddImageFile?: (file: File) => void;
  activeSessionId?: string | null;
  /**
   * Panel-level actions come from the surface that hosts the browser. Omitted
   * surfaces hide the buttons instead of rendering dead chrome (spec §4.2).
   */
  panelActions?: BrowserPanelPanelActions | undefined;
};

export type BrowserPanelPanelActions = {
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
};

export function BrowserSessionPanel(props: BrowserSessionPanelProps): ReactElement {
  const { hostClient, onAddWebElement, onAddImageFile, activeSessionId } = props;
  const { locale } = useDesktopLocale();
  const copy = browserSessionCopy(locale);
  const {
    frame,
    committedUrl,
    mirrorLeaseId,
    urlInput,
    setUrlInput,
    title,
    highlight,
    setHighlight,
    pickPending,
    setPickPending,
    pickError,
    setPickError,
    mirrorError,
    owner,
    consoleLines,
    networkLines,
    lifecycle,
    mirror,
    generation,
    pageId,
    tabs,
    pendingDialog,
    viewport,
    documentRevision,
    frameError,
  } = useBrowserSessionLease({
    hostClient,
    onAddWebElement,
    mirrorStartFailed: copy.mirrorStartFailed,
    mirrorStopFailed: copy.mirrorStopFailed,
  });
  const [pickMode, setPickMode] = useState(false);
  const [annotateMode, setAnnotateMode] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imeRef = useRef<HTMLTextAreaElement>(null);
  // The preference is read once per panel mount; the menu that changes it ships
  // with the two-layer chrome (spec §4.2).
  const [viewportPreference, setViewportPreference] = useState(loadBrowserViewportPreference);
  const [devDrawerOpen, setDevDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<BrowserPanelNotice | null>(null);
  // Identical consecutive failures collapse into one bounded notice (§4.2).
  const pushNotice = useCallback((message: string) => {
    setNotice((current) =>
      current !== null && current.message === message
        ? { message, count: current.count + 1 }
        : { message, count: 1 },
    );
  }, []);
  useBrowserViewport({
    containerRef,
    enabled: viewportPreference.mode === 'follow',
    leaseId: mirrorLeaseId,
    resize: (width, height, resizeOptions) =>
      hostClient.browserResize(width, height, resizeOptions),
  });
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const apply = (): void => {
      const box = resolveFollowViewportBox(element);
      if (box) setPanelSize(box);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const runtimeStatus = resolveBrowserRuntimeStatus(locale, {
    lifecycle,
    mirror,
    mirrorError,
  });
  const interactEnabled = runtimeStatus.interactEnabled;
  const target =
    generation !== undefined && pageId !== undefined && documentRevision !== undefined
      ? { generation, pageId, documentRevision }
      : undefined;
  const input = useBrowserInput({
    hostClient,
    imgRef,
    viewportWidth: frame.viewportWidth,
    viewportHeight: frame.viewportHeight,
    interactEnabled: interactEnabled && !annotateMode,
    pickMode,
    ...(target === undefined ? {} : { target }),
    onPickStart: () => {
      setPickPending(true);
      setPickError(null);
      setHighlight(null);
    },
    onPickFailed: () => setPickError(copy.pickFailed),
    onPickSettled: () => setPickPending(false),
  });

  const handleImeKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      const decision = keyEventToBrowserInput({
        type: event.type === 'keyup' ? 'keyup' : 'keydown',
        key: event.key,
        isComposing: event.nativeEvent.isComposing,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      if (decision === 'ignore') return;
      event.preventDefault();
      if (decision === 'prevent-and-ignore') return;
      input.sendKeyEvents(decision);
    },
    [input],
  );


  const handleNavigate = useCallback(
    async (event?: FormEvent): Promise<void> => {
      event?.preventDefault();
      if (!interactEnabled) return;
      const normalized = normalizeUrl(urlInput);
      if (!normalized) return;
      setUrlInput(normalized);
      await hostClient
        .browserNavigate(normalized)
        .then((response) => {
          if (!response.success) pushNotice(copy.commandFailed);
        })
        .catch(() => pushNotice(copy.commandFailed));
    },
    [interactEnabled, hostClient, urlInput, pushNotice, copy.commandFailed, setUrlInput],
  );

  const handleReload = useCallback((): void => {
    void hostClient
      .browserReload()
      .then((response) => {
        if (!response.success) pushNotice(copy.commandFailed);
      })
      .catch(() => pushNotice(copy.commandFailed));
  }, [hostClient, pushNotice, copy.commandFailed]);

  const handleOpenExternal = useCallback((): void => {
    if (committedUrl.length === 0) return;
    void openExternalUrl(committedUrl).then((opened) => {
      if (!opened) pushNotice(copy.panelActionFailed);
    });
  }, [committedUrl, pushNotice, copy.panelActionFailed]);

  const handleSelectViewport = useCallback(
    (selection: { id: BrowserViewportPresetId; width: number; height: number }): void => {
      const mode = BROWSER_VIEWPORT_MENU_PRESETS[selection.id].mode;
      const displayZoom = viewportPreference.displayZoom ?? 'fit';
      setViewportPreference({ mode, width: selection.width, height: selection.height, displayZoom });
      saveBrowserViewportPreference({ mode, width: selection.width, height: selection.height, displayZoom });
      if (mode === 'follow') return;
      void hostClient
        .browserResize(selection.width, selection.height, { mode, origin: 'explicit' })
        .then((response) => {
          if (!response.success) pushNotice(copy.viewportFailed);
        })
        .catch(() => pushNotice(copy.viewportFailed));
    },
    [hostClient, pushNotice, copy.viewportFailed, viewportPreference.displayZoom],
  );

  const handleSelectDisplayZoom = useCallback((displayZoom: BrowserDisplayZoom): void => {
    const next = { ...viewportPreference, displayZoom };
    setViewportPreference(next);
    saveBrowserViewportPreference(next);
  }, [viewportPreference]);

  let overlay: BrowserHighlightBox | null = null;
  if (highlight && imgRef.current && frame.viewportWidth > 0) {
    overlay = displayRectFromFilledViewport({
      viewportX: highlight.x,
      viewportY: highlight.y,
      viewportBoxWidth: highlight.width,
      viewportBoxHeight: highlight.height,
      displayWidth: imgRef.current.clientWidth,
      displayHeight: imgRef.current.clientHeight,
      viewportWidth: frame.viewportWidth,
      viewportHeight: frame.viewportHeight,
    });
  }
  let overlayOffsetX = 0;
  let overlayOffsetY = 0;
  if (overlay && imgRef.current && containerRef.current) {
    const imgRect = imgRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    overlayOffsetX = imgRect.left - containerRect.left;
    overlayOffsetY = imgRect.top - containerRect.top;
  }

  const displayZoom: BrowserDisplayZoom =
    viewportPreference.mode === 'follow' ? 'fit' : (viewportPreference.displayZoom ?? 'fit');
  // Follow mode keeps the Host viewport at the panel size, so the frame always
  // fills the panel. While a resize is still in flight the last frame stretches
  // for a moment instead of shrinking into a letterboxed island. A viewport the
  // agent or a preset pinned to another mode keeps the aspect-true fit.
  const fillPanel =
    viewportPreference.mode === 'follow' && (viewport === undefined || viewport.mode === 'follow');
  const displayBox =
    fillPanel && frame.viewportWidth > 0 && panelSize.width > 0
      ? {
          width: panelSize.width,
          height: panelSize.height,
          scale: panelSize.width / frame.viewportWidth,
        }
      : resolveBrowserDisplayBox({
          panelWidth: panelSize.width,
          panelHeight: panelSize.height,
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
          zoom: displayZoom,
        });
  // Encoded JPEG size vs the pixels this panel needs (spec §4.1.1).
  const density = resolveBrowserMirrorDensity({
    frame,
    displayWidth: imgRef.current?.clientWidth || displayBox.width,
    displayHeight: imgRef.current?.clientHeight || displayBox.height,
    devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
  });
  const densityLabel = formatBrowserDensityRatio(density);
  const diagnosticRows = [
    ...(frame.viewportWidth > 0
      ? [{ label: copy.diagCss, value: `${String(frame.viewportWidth)}x${String(frame.viewportHeight)}` }]
      : []),
    ...(frame.encodedWidth !== undefined && frame.encodedHeight !== undefined
      ? [{ label: copy.diagEncoded, value: `${String(frame.encodedWidth)}x${String(frame.encodedHeight)}` }]
      : []),
    ...(frame.sourceDpr !== undefined
      ? [{ label: copy.diagDpr, value: String(frame.sourceDpr) }]
      : []),
    ...(displayBox.width > 0
      ? [{ label: copy.diagDisplay, value: `${String(displayBox.width)}x${String(displayBox.height)}` }]
      : []),
    ...(densityLabel !== undefined ? [{ label: copy.diagDensity, value: densityLabel }] : []),
    ...(frame.quality !== undefined ? [{ label: copy.diagQuality, value: String(frame.quality) }] : []),
    ...(frame.producer !== undefined && frame.producer.length > 0
      ? [{ label: copy.diagProducer, value: frame.producer }]
      : []),
  ];

  return (
    <div className="browser-session-panel" data-testid="browser-session-panel">
      <BrowserSessionChrome
        hostClient={hostClient}
        copy={copy}
        draftUrl={urlInput}
        committedUrl={committedUrl}
        onDraftUrl={setUrlInput}
        onNavigate={() => {
          void handleNavigate();
        }}
        onReload={handleReload}
        interactEnabled={interactEnabled}
        pickActive={pickMode}
        onTogglePick={() => {
          setAnnotateMode(false);
          setPickMode((current) => !current);
        }}
        annotateActive={annotateMode}
        onToggleAnnotate={() => {
          setPickMode(false);
          setAnnotateMode((current) => {
            const next = !current;
            if (next) {
              void hostClient.browserCapture({
                ...(activeSessionId ? { sessionId: activeSessionId } : {}),
              });
            }
            return next;
          });
        }}
        controller={owner}
        producer={frame.producer}
        tabs={tabs}
        pendingDialog={pendingDialog}
        viewport={viewport}
        viewportMode={resolveViewportPresetId(viewportPreference)}
        viewportSize={viewportPreference}
        viewportPresets={[
          { id: 'responsive', label: copy.viewportResponsive },
          { id: 'desktop', label: copy.viewportDesktop },
          { id: 'mobile', label: copy.viewportMobile },
          { id: 'tablet', label: copy.viewportTablet },
          { id: 'custom', label: copy.viewportCustom },
        ]}
        onSelectViewport={handleSelectViewport}
        displayZoom={displayZoom}
        displayScale={displayBox.scale}
        onSelectDisplayZoom={handleSelectDisplayZoom}
        density={density}
        devDrawerOpen={devDrawerOpen}
        onToggleDevDrawer={() => setDevDrawerOpen((current) => !current)}
        onOpenExternal={handleOpenExternal}
        panelActions={props.panelActions}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />

      {runtimeStatus.showBanner ? (
        <div className="browser-session-banner br-banner" data-testid="browser-session-runtime-banner">
          <span>{runtimeStatus.message}</span>
          <button
            type="button"
            data-testid="browser-session-restart"
            onClick={() => void hostClient.browserRestart()}
          >
            {runtimeStatus.restartLabel}
          </button>
        </div>
      ) : null}

      <div className="browser-session-toolbar">
        {pickPending ? (
          <span className="browser-session-pick-pending" data-testid="browser-session-pick-pending">
            {copy.pickPending}
          </span>
        ) : null}
        {pickError ? (
          <span className="browser-session-pick-error" data-testid="browser-session-pick-error">
            {pickError}
          </span>
        ) : null}
        {mirrorError && !runtimeStatus.showBanner ? (
          <span className="browser-session-pick-error" data-testid="browser-session-mirror-error">
            {mirrorError}
          </span>
        ) : null}
        {frameError ? (
          <span className="browser-session-pick-error" data-testid="browser-session-frame-error">
            {frameError === 'client-update-required' || frameError === 'unavailable'
              ? copy.frameUnavailable
              : copy.commandFailed}
          </span>
        ) : null}
        {highlight ? (
          <button type="button" className="browser-session-clear-highlight" onClick={() => setHighlight(null)} aria-label={copy.clearHighlight}>
            <IconClose width={12} height={12} />
          </button>
        ) : null}
      </div>

      <BrowserViewportSurface
        containerRef={containerRef}
        imgRef={imgRef}
        imeRef={imeRef}
        frameSrc={frame.src}
        frameAlt={title || urlInput || copy.frameAlt}
        starting={copy.starting}
        pickMode={pickMode}
        interactEnabled={interactEnabled}
        runtimeInteractEnabled={runtimeStatus.interactEnabled}
        displayBox={displayBox}
        fillPanel={fillPanel}
        zoom={displayZoom}
        overlay={overlay}
        overlayOffsetX={overlayOffsetX}
        overlayOffsetY={overlayOffsetY}
        onPointerDown={input.onPointerDown}
        onPointerMove={input.onPointerMove}
        onPointerUp={input.onPointerUp}
        onPointerCancel={input.onPointerCancel}
        onClick={input.onClick}
        onWheel={input.onWheel}
        onImeKey={handleImeKey}
        onCompositionEnd={(event) => {
          const insert = compositionEndToInsertText(event.data);
          if (insert) input.sendKeyEvents([insert]);
          event.currentTarget.value = '';
        }}
        onPaste={(event) => {
          event.preventDefault();
          const insert = pasteToInsertText(event.clipboardData.getData('text'));
          if (insert) input.sendKeyEvents([insert]);
        }}
      >
        {annotateMode && frame.src ? (
          <BrowserAnnotationOverlay
            imageSrc={frame.src}
            copy={{
              close: copy.annotateExit,
              addToChat: copy.annotateAdd,
              undo: copy.annotateUndo,
              redo: copy.annotateRedo,
              clear: copy.annotateClear,
              pen: copy.annotatePen,
              line: copy.annotateLine,
              arrow: copy.annotateArrow,
              rect: copy.annotateRect,
              ellipse: copy.annotateEllipse,
              text: copy.annotateText,
            }}
            onClose={() => setAnnotateMode(false)}
            onAddToChat={(file) => onAddImageFile?.(file)}
          />
        ) : null}
      </BrowserViewportSurface>
      {devDrawerOpen ? (
        <BrowserConsoleDrawer
          open
          consoleLines={consoleLines}
          networkLines={networkLines}
          diagnosticRows={diagnosticRows}
        />
      ) : null}
    </div>
  );
}
