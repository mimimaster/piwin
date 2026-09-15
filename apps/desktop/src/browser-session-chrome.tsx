/**
 * Browser workbench chrome (spec §4.2).
 *
 * Row 1: tabs and panel actions. Row 2: navigation, address bar, mode group.
 * Controls are icon-only — the address bar submits on Enter, Reload always
 * targets the Host-committed page and never reads the draft, and the mode group
 * keeps pick/viewport directly reachable.
 */
import { type FormEvent, type ReactElement } from 'react';
import type {
  BrowserController,
  BrowserDialogInfo,
  BrowserTabInfo,
  BrowserViewportConfig,
} from '@piwin/contracts';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, IconButton } from '@piwin/ui-kit';
import type { HostClient } from './host-client';
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
  idle: string;
  youHaveControl: string;
  agentUsing: string;
  takeOver: string;
  giveBack: string;
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
  controller: BrowserController;
  onToggleControl: () => void;
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
    onToggleControl,
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

  const controlLabel =
    controller === 'agent'
      ? copy.agentUsing
      : controller === 'user'
        ? copy.youHaveControl
        : copy.idle;
  const controlAction = controller === 'agent' ? copy.takeOver : copy.giveBack;

  return (
    <div className="browser-session-chrome" data-testid="browser-session-chrome">
      <div className="browser-session-chrome-row browser-session-tabs" data-testid="browser-session-tabs">
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
                void requestBrowserCloseTab(hostClient, tab.pageId);
              }}
            >
              <IconClose width={10} height={10} />
            </button>
          </span>
        ))}
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

        <div className="browser-session-chrome-spacer" />

        <div className="browser-session-chrome-actions">
          <IconButton
            className={`browser-session-icon-btn${devDrawerOpen ? ' active' : ''}`}
            data-testid="browser-session-dev-drawer"
            label={copy.devDrawer}
            size={28}
            aria-pressed={devDrawerOpen}
            onClick={onToggleDevDrawer}
          >
            <IconTerminal width={15} height={15} />
          </IconButton>
          <DropdownMenu
            testId="browser-session-more-menu"
            align="end"
            label={copy.more}
            trigger={
              <IconButton
                className="browser-session-icon-btn"
                data-testid="browser-session-more"
                label={copy.more}
                size={28}
              >
                <IconMore width={15} height={15} />
              </IconButton>
            }
          >
            <DropdownMenuItem
              testId="browser-session-more-external"
              icon={<IconExternalLink width={13} height={13} />}
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
        </div>
      </div>

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
        <IconButton
          className="browser-session-icon-btn"
          data-testid="browser-session-open-external"
          label={copy.openExternal}
          size={28}
          disabled={committedUrl.length === 0}
          onClick={onOpenExternal}
        >
          <IconExternalLink width={15} height={15} />
        </IconButton>

        <div className="browser-session-mode-group" data-testid="browser-session-mode-group">
          <button
            type="button"
            className="browser-session-control"
            data-testid="browser-session-control"
            data-owner={controller}
            title={`${controlLabel} · ${controlAction}`}
            aria-label={`${controlLabel} · ${controlAction}`}
            // Take-over stays available while the agent owns the page; only the
            // nobody-holds-it state has no action to offer.
            disabled={controller === 'idle'}
            onClick={onToggleControl}
          >
            <span className="browser-session-control-dot" aria-hidden="true" />
          </button>

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
