/**
 * Browser workbench chrome (spec §4.2).
 *
 * Row 1: tabs and panel actions — inside the right panel it merges into that
 * panel's titlebar instead. Row 2: navigation, address bar, mode group.
 * Secondary tools (console, open external, restart) live in the ⋯ menu.
 * The host titlebar already has a + (open another tool). Do not add a second
 * + for new tab there — that action goes in ⋯ while chrome is merged.
 * Controls are icon-only — the address bar submits on Enter, Reload always
 * targets the Host-committed page and never reads the draft, and the mode group
 * keeps pick/viewport directly reachable.
 */
import { useEffect, type FormEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type {
  BrowserController,
  BrowserDialogInfo,
  BrowserTabInfo,
  BrowserViewportConfig,
} from '@piwin/contracts';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, IconButton } from '@piwin/ui-kit';
import type { HostClient } from './host-client';
import { useSurfaceTitlebar } from './surface-titlebar.js';
import {
  requestBrowserBack,
  requestBrowserCloseTab,
  requestBrowserDialog,
  requestBrowserForward,
  requestBrowserNewTab,
  requestBrowserSelectTab,
} from './host-client-browser';
import type { BrowserDisplayZoom } from './browser-display-box';
import type { BrowserMirrorDensity } from './browser-mirror-density';
import {
  BrowserViewportMenu,
  type BrowserViewportPresetEntry,
} from './browser-viewport-menu';
import type { BrowserViewportPresetId, BrowserViewportSize } from './hooks/use-browser-viewport';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBrowser,
  IconClose,
  IconCompress,
  IconExpand,
  IconExternalLink,
  IconMore,
  IconPlus,
  IconEdit,
  IconPointer,
  IconRefresh,
  IconTerminal,
} from './shell-icons';

export type BrowserSessionChromeCopy = {
  address: string;
  urlPlaceholder: string;
  reload: string;
  back: string;
  forward: string;
  newTab: string;
  closeTab: string;
  acceptDialog: string;
  dismissDialog: string;
  pickDisabled: string;
  pickExit: string;
  pickEnter: string;
  annotate: string;
  annotateExit: string;
  openExternal: string;
  devDrawer: string;
  more: string;
  expand: string;
  collapse: string;
  closePanel: string;
  restart: string;
  dismissNotice: string;
  /** Shown when identical failures repeat: `{count}` is replaced. */
  noticeRepeat: string;
  agentUsing: string;
  viewportTitle: string;
  viewportResponsive: string;
  viewportDesktop: string;
  viewportMobile: string;
  viewportTablet: string;
  viewportCustom: string;
  viewportWidth: string;
  viewportHeight: string;
  viewportApply: string;
  densityLow: string;
  densityEncoded: string;
  densityRequired: string;
  densityProducer: string;
  viewportSetByAgent: string;
  viewportFit: string;
  viewportZoom100: string;
};

export type BrowserPanelPanelActions = {
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
};

export type BrowserPanelNotice = { message: string; count: number };

export type BrowserSessionChromeProps = {
  hostClient: HostClient;
  copy: BrowserSessionChromeCopy;
  draftUrl: string;
  committedUrl: string;
  onDraftUrl: (value: string) => void;
  onNavigate: () => void;
  onReload: () => void;
  interactEnabled: boolean;
  pickActive: boolean;
  onTogglePick: () => void;
  annotateActive: boolean;
  onToggleAnnotate: () => void;
  /** Activity indicator only: the agent never locks the user out. */
  controller: BrowserController;
  /** Writer of the last delivered frame, shown in the density tooltip. */
  producer?: string | undefined;
  tabs: BrowserTabInfo[];
  pendingDialog: BrowserDialogInfo | null;
  viewport: BrowserViewportConfig | undefined;
  viewportMode: BrowserViewportPresetId;
  viewportSize: BrowserViewportSize;
  viewportPresets: BrowserViewportPresetEntry[];
  onSelectViewport: (preference: { id: BrowserViewportPresetId; width: number; height: number }) => void;
  displayZoom: BrowserDisplayZoom;
  displayScale: number;
  onSelectDisplayZoom: (zoom: BrowserDisplayZoom) => void;
  density: BrowserMirrorDensity;
  devDrawerOpen: boolean;
  onToggleDevDrawer: () => void;
  onOpenExternal: () => void;
  panelActions?: BrowserPanelPanelActions | undefined;
  notice?: BrowserPanelNotice | null | undefined;
  onDismissNotice?: (() => void) | undefined;
};

export function BrowserSessionChrome(props: BrowserSessionChromeProps): ReactElement {
  const {
    hostClient,
    copy,
    draftUrl,
    committedUrl,
    onDraftUrl,
    onNavigate,
    onReload,
    interactEnabled,
    pickActive,
    onTogglePick,
    annotateActive,
    onToggleAnnotate,
    controller,
    producer,
    tabs,
    pendingDialog,
    viewport,
    viewportMode,
    viewportSize,
    viewportPresets,
    onSelectViewport,
    displayZoom,
    displayScale,
    onSelectDisplayZoom,
    density,
    devDrawerOpen,
    onToggleDevDrawer,
    onOpenExternal,
    panelActions,
    notice,
    onDismissNotice,
  } = props;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onNavigate();
  }

  // A host panel may hand us its titlebar: page tabs then replace its
  // redundant 「浏览器」 tool tab instead of stacking a second row under it.
  const titlebar = useSurfaceTitlebar();
  const tabsSlot = titlebar?.tabsSlot ?? null;
  const actionsSlot = titlebar?.actionsSlot ?? null;
  const inTitlebar = tabsSlot !== null && actionsSlot !== null;
  const pageTabCount = tabs.length;
  const closeHost = titlebar?.closeHost;
  const setPageTabCount = titlebar?.setPageTabCount;

  useEffect(() => {
    if (!setPageTabCount) return;
    setPageTabCount(pageTabCount);
    return () => setPageTabCount(0);
  }, [pageTabCount, setPageTabCount]);

  const tabsNode = (
    <>
      {tabs.map((tab) => (
        <span
          key={tab.pageId}
          className={`browser-session-tab${tab.active ? ' active' : ''}`}
          data-testid={`browser-session-tab-${tab.pageId}`}
        >
          <button
            type="button"
            className="browser-session-tab-select"
            disabled={!interactEnabled}
            onClick={() => {
              void requestBrowserSelectTab(hostClient, tab.pageId);
            }}
          >
            <IconBrowser width={12} height={12} />
            <span className="browser-session-tab-label">{tab.title || tab.url || tab.pageId}</span>
          </button>
          <button
            type="button"
            className="browser-session-tab-close"
            data-testid={`browser-session-tab-close-${tab.pageId}`}
            aria-label={copy.closeTab}
            disabled={!interactEnabled}
            onClick={() => {
              const lastPageTab = pageTabCount <= 1;
              void requestBrowserCloseTab(hostClient, tab.pageId);
              if (lastPageTab) closeHost?.();
            }}
          >
            <IconClose width={10} height={10} />
          </button>
        </span>
      ))}
      {inTitlebar ? null : (
        <IconButton
          className="browser-session-icon-btn"
          data-testid="browser-session-new-tab"
          label={copy.newTab}
          size={24}
          disabled={!interactEnabled}
          onClick={() => {
            void requestBrowserNewTab(hostClient);
          }}
        >
          <IconPlus width={14} height={14} />
        </IconButton>
      )}
    </>
  );

  // One overflow menu instead of a row of rarely used icons.
  const moreMenu = (
    <DropdownMenu
      testId="browser-session-more-menu"
      align="end"
      label={copy.more}
      trigger={
        <IconButton
          className={`browser-session-icon-btn${devDrawerOpen ? ' active' : ''}`}
          data-testid="browser-session-more"
          label={copy.more}
          size={28}
        >
          <IconMore width={15} height={15} />
        </IconButton>
      }
    >
      {inTitlebar ? (
        <>
          <DropdownMenuItem
            testId="browser-session-more-new-tab"
            icon={<IconPlus width={13} height={13} />}
            disabled={!interactEnabled}
            onSelect={() => {
              void requestBrowserNewTab(hostClient);
            }}
          >
            {copy.newTab}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuItem
        testId="browser-session-dev-drawer"
        icon={<IconTerminal width={13} height={13} />}
        onSelect={onToggleDevDrawer}
        {...(devDrawerOpen ? { shortcut: '✓' } : {})}
      >
        {copy.devDrawer}
      </DropdownMenuItem>
      <DropdownMenuItem
        testId="browser-session-more-external"
        icon={<IconExternalLink width={13} height={13} />}
        disabled={committedUrl.length === 0}
        onSelect={onOpenExternal}
      >
        {copy.openExternal}
      </DropdownMenuItem>
      <DropdownMenuItem
        testId="browser-session-more-restart"
        icon={<IconRefresh width={13} height={13} />}
        disabled={!interactEnabled}
        onSelect={() => {
          void hostClient.browserRestart();
        }}
      >
        {copy.restart}
      </DropdownMenuItem>
      {pendingDialog ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            testId="browser-session-more-dialog-accept"
            disabled={!interactEnabled}
            onSelect={() => {
              void requestBrowserDialog(hostClient, 'accept');
            }}
          >
            {copy.acceptDialog}
          </DropdownMenuItem>
          <DropdownMenuItem
            testId="browser-session-more-dialog-dismiss"
            disabled={!interactEnabled}
            onSelect={() => {
              void requestBrowserDialog(hostClient, 'dismiss');
            }}
          >
            {copy.dismissDialog}
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenu>
  );

  // In a host titlebar the host's own expand/close sit right after this slot.
  const actionsNode = inTitlebar ? (
    moreMenu
  ) : (
    <>
      {moreMenu}
      {panelActions ? (
        <>
          <IconButton
            className={`browser-session-icon-btn${panelActions.expanded ? ' active' : ''}`}
            data-testid="browser-session-expand"
            label={panelActions.expanded ? copy.collapse : copy.expand}
            size={28}
            aria-pressed={panelActions.expanded}
            onClick={panelActions.onToggleExpand}
          >
            {panelActions.expanded ? (
              <IconCompress width={15} height={15} />
            ) : (
              <IconExpand width={15} height={15} />
            )}
          </IconButton>
          <IconButton
            className="browser-session-icon-btn"
            data-testid="browser-session-close-panel"
            label={copy.closePanel}
            size={28}
            onClick={panelActions.onClose}
          >
            <IconClose width={15} height={15} />
          </IconButton>
        </>
      ) : null}
    </>
  );

  return (
    <div className="browser-session-chrome" data-testid="browser-session-chrome">
      {tabsSlot && actionsSlot ? (
        <>
          {createPortal(
            <div
              className="browser-session-tabs browser-session-titlebar-tabs"
              data-testid="browser-session-tabs"
            >
              {tabsNode}
            </div>,
            tabsSlot,
          )}
          {createPortal(
            <div className="browser-session-chrome-actions browser-session-titlebar-actions">{actionsNode}</div>,
            actionsSlot,
          )}
        </>
      ) : titlebar ? null : (
        <div className="browser-session-chrome-row browser-session-tabs" data-testid="browser-session-tabs">
          {tabsNode}
          <div className="browser-session-chrome-spacer" />
          <div className="browser-session-chrome-actions">{actionsNode}</div>
        </div>
      )}

      <div className="browser-session-chrome-row browser-session-urlbar">
        <IconButton
          className="browser-session-icon-btn"
          data-testid="browser-session-back"
          label={copy.back}
          size={28}
          disabled={!interactEnabled}
          onClick={() => {
            void requestBrowserBack(hostClient);
          }}
        >
          <IconArrowLeft width={15} height={15} />
        </IconButton>
        <IconButton
          className="browser-session-icon-btn"
          data-testid="browser-session-forward"
          label={copy.forward}
          size={28}
          disabled={!interactEnabled}
          onClick={() => {
            void requestBrowserForward(hostClient);
          }}
        >
          <IconArrowRight width={15} height={15} />
        </IconButton>
        <IconButton
          className="browser-session-icon-btn"
          data-testid="browser-session-reload"
          label={copy.reload}
          size={28}
          disabled={!interactEnabled}
          onClick={onReload}
        >
          <IconRefresh width={15} height={15} />
        </IconButton>

        <form className="browser-session-address" onSubmit={handleSubmit}>
          <input
            className="browser-session-url-input"
            data-testid="browser-session-url-input"
            type="text"
            value={draftUrl}
            disabled={!interactEnabled}
            aria-label={copy.address}
            onChange={(event) => onDraftUrl(event.target.value)}
            onPaste={(event) => event.stopPropagation()}
            placeholder={copy.urlPlaceholder}
            spellCheck={false}
          />
        </form>
        <div className="browser-session-mode-group" data-testid="browser-session-mode-group">
          {controller === 'agent' ? (
            <span
              className="browser-session-agent-activity"
              data-testid="browser-session-agent-activity"
              role="status"
              title={copy.agentUsing}
              aria-label={copy.agentUsing}
            />
          ) : null}

          <IconButton
            className={`browser-session-icon-btn${annotateActive ? ' active' : ''}`}
            data-testid="browser-session-annotate"
            label={annotateActive ? copy.annotateExit : copy.annotate}
            size={28}
            aria-pressed={annotateActive}
            onClick={onToggleAnnotate}
          >
            <IconEdit width={15} height={15} />
          </IconButton>

          <IconButton
            className={`browser-session-icon-btn${pickActive ? ' active' : ''}`}
            data-testid="browser-session-pick-toggle"
            label={!interactEnabled ? copy.pickDisabled : pickActive ? copy.pickExit : copy.pickEnter}
            size={28}
            disabled={!interactEnabled}
            aria-pressed={pickActive}
            onClick={onTogglePick}
          >
            <IconPointer width={15} height={15} />
          </IconButton>

          <BrowserViewportMenu
            copy={copy}
            interactEnabled={interactEnabled}
            producer={producer}
            viewport={viewport}
            viewportMode={viewportMode}
            viewportSize={viewportSize}
            viewportPresets={viewportPresets}
            displayZoom={displayZoom}
            displayScale={displayScale}
            density={density}
            onSelectViewport={onSelectViewport}
            onSelectDisplayZoom={onSelectDisplayZoom}
          />
        </div>
      </div>

      {pendingDialog ? (
        <div className="browser-session-banner br-banner" data-testid="browser-session-dialog">
          <span>
            {pendingDialog.type}: {pendingDialog.message}
          </span>
          <button
            type="button"
            data-testid="browser-session-dialog-accept"
            disabled={!interactEnabled}
            onClick={() => {
              void requestBrowserDialog(hostClient, 'accept');
            }}
          >
            {copy.acceptDialog}
          </button>
          <button
            type="button"
            data-testid="browser-session-dialog-dismiss"
            disabled={!interactEnabled}
            onClick={() => {
              void requestBrowserDialog(hostClient, 'dismiss');
            }}
          >
            {copy.dismissDialog}
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="browser-session-notice" data-testid="browser-session-notice" role="status">
          <span className="browser-session-notice-text">{notice.message}</span>
          {notice.count > 1 ? (
            <span className="browser-session-notice-count">
              {copy.noticeRepeat.replace('{count}', String(notice.count))}
            </span>
          ) : null}
          <IconButton
            className="browser-session-icon-btn"
            data-testid="browser-session-notice-dismiss"
            label={copy.dismissNotice}
            size={22}
            onClick={onDismissNotice}
          >
            <IconClose width={12} height={12} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
