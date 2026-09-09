/**
 * URL bar, tabs, dialog, and viewport chip for the browser workbench.
 */
import type { FormEvent, ReactElement } from 'react';
import type {
  BrowserDialogInfo,
  BrowserTabInfo,
  BrowserViewportConfig,
} from '@piwin/contracts';
import type { HostClient } from './host-client';
import {
  requestBrowserBack,
  requestBrowserCloseTab,
  requestBrowserDialog,
  requestBrowserForward,
  requestBrowserNewTab,
  requestBrowserSelectTab,
} from './host-client-browser';
import { IconArrowLeft, IconArrowRight, IconClose, IconPlus, IconRefresh } from './shell-icons';

export type BrowserSessionChromeCopy = {
  urlPlaceholder: string;
  go: string;
  reload: string;
  navigate: string;
  back: string;
  forward: string;
  newTab: string;
  closeTab: string;
  acceptDialog: string;
  dismissDialog: string;
};

export type BrowserSessionChromeProps = {
  hostClient: HostClient;
  copy: BrowserSessionChromeCopy;
  urlInput: string;
  onUrlInput: (value: string) => void;
  onNavigate: () => void;
  interactEnabled: boolean;
  tabs: BrowserTabInfo[];
  pendingDialog: BrowserDialogInfo | null;
  viewport: BrowserViewportConfig | undefined;
};

export function BrowserSessionChrome(props: BrowserSessionChromeProps): ReactElement {
  const {
    hostClient,
    copy,
    urlInput,
    onUrlInput,
    onNavigate,
    interactEnabled,
    tabs,
    pendingDialog,
    viewport,
  } = props;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onNavigate();
  }

  return (
    <>
      {tabs.length > 0 ? (
        <div className="browser-session-tabs" data-testid="browser-session-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.pageId}
              type="button"
              className={`browser-session-tab${tab.active ? ' active' : ''}`}
              data-testid={`browser-session-tab-${tab.pageId}`}
              disabled={!interactEnabled}
              onClick={() => {
                void requestBrowserSelectTab(hostClient, tab.pageId);
              }}
            >
              <span className="browser-session-tab-label">{tab.title || tab.url || tab.pageId}</span>
              <span
                className="browser-session-tab-close"
                role="button"
                tabIndex={-1}
                aria-label={copy.closeTab}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!interactEnabled) return;
                  void requestBrowserCloseTab(hostClient, tab.pageId);
                }}
              >
                <IconClose width={10} height={10} />
              </span>
            </button>
          ))}
          <button
            type="button"
            className="browser-session-tab-new"
            data-testid="browser-session-new-tab"
            disabled={!interactEnabled}
            aria-label={copy.newTab}
            onClick={() => {
              void requestBrowserNewTab(hostClient);
            }}
          >
            <IconPlus width={12} height={12} />
          </button>
        </div>
      ) : null}

      <form className="browser-session-urlbar" onSubmit={handleSubmit}>
        <button
          type="button"
          className="browser-session-nav-btn"
          data-testid="browser-session-back"
          aria-label={copy.back}
          disabled={!interactEnabled}
          onClick={() => {
            void requestBrowserBack(hostClient);
          }}
        >
          <IconArrowLeft width={14} height={14} />
        </button>
        <button
          type="button"
          className="browser-session-nav-btn"
          data-testid="browser-session-forward"
          aria-label={copy.forward}
          disabled={!interactEnabled}
          onClick={() => {
            void requestBrowserForward(hostClient);
          }}
        >
          <IconArrowRight width={14} height={14} />
        </button>
        <input
          className="browser-session-url-input"
          data-testid="browser-session-url-input"
          type="text"
          value={urlInput}
          disabled={!interactEnabled}
          onChange={(event) => onUrlInput(event.target.value)}
          onPaste={(event) => event.stopPropagation()}
          placeholder={copy.urlPlaceholder}
          spellCheck={false}
        />
        <button
          type="submit"
          className="browser-session-go-btn"
          data-testid="browser-session-go-btn"
          aria-label={copy.navigate}
          disabled={!interactEnabled}
        >
          {copy.go}
        </button>
        <button
          type="button"
          className="browser-session-refresh-btn"
          onClick={() => onNavigate()}
          aria-label={copy.reload}
          title={copy.reload}
          disabled={!interactEnabled}
        >
          <IconRefresh width={14} height={14} />
        </button>
        {viewport ? (
          <span className="browser-session-viewport" data-testid="browser-session-viewport">
            {viewport.width}×{viewport.height}
          </span>
        ) : null}
      </form>

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
    </>
  );
}
