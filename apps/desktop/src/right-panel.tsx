/**
 * Right workspace panel — closed by default.
 *
 * Quiet workbench IA (prototype v2.3):
 * - Outer: whole rail expands/collapses from the titleband panel toggle.
 * - Inner: directory home first; drill into a section; back returns to home.
 * - Terminal shows process count + chevron only when processes are live.
 * - Last inner view is restored from sessionStorage on reopen.
 * - Terminal new output while on directory: row breath pulse only (never auto-open).
 *
 * Outward expand (desktop / Tauri) is unchanged: window grows, stage width holds.
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  IconCards,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFolder,
  IconGit,
  IconNote,
  IconTerminal,
} from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import { IconButton, ListRow } from '@piwin/ui-kit';
import {
  readStoredRightPanelView,
  writeStoredRightPanelView,
} from './right-panel-memory';

export type RightPanelTab = 'files' | 'activity' | 'review' | 'notes' | 'cards';

export type RightPanelView = 'home' | 'detail';

export type RightPanelProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  panelWidthPx: number;
  isResizing: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onResizeReset: () => void;
  isOverlayPresentation?: boolean;
  filesContent: ReactNode;
  activityContent: ReactNode;
  reviewContent: ReactNode;
  /** Notes library panel (ADR 0018 S6). */
  notesContent?: ReactNode;
  /** Flashcards review panel (ADR 0018 S7). */
  cardsContent?: ReactNode;
  changesCount?: number;
  /** Live terminal / managed process count — drives Terminal row affordances. */
  runningProcessCount?: number;
  /** Optional due flashcard count for Cards row. */
  cardsDueCount?: number;
  /**
   * Quiet workbench: new terminal output while directory is visible (or panel
   * was collapsed). Shows a row-end breath pulse; never auto-expands.
   */
  terminalAttention?: boolean;
  /** Fired when the user opens the Terminal detail (clears attention upstream). */
  onTerminalAttentionClear?: () => void;
  /** Notifies shell of inner view for attention gating (home vs detail). */
  onViewChange?: (view: RightPanelView) => void;
  locale?: DesktopLocale;
};

const DIRECTORY_ITEMS: Array<{
  id: RightPanelTab;
  icon: ReactElement;
  labelEn: string;
  labelZh: string;
  hint?: string;
}> = [
  { id: 'review', icon: <IconGit />, labelEn: 'Changes', labelZh: 'Changes' },
  { id: 'activity', icon: <IconTerminal />, labelEn: 'Terminal', labelZh: '终端' },
  { id: 'files', icon: <IconFolder />, labelEn: 'Files', labelZh: 'Files' },
  { id: 'notes', icon: <IconNote />, labelEn: 'Notes', labelZh: 'Notes' },
  { id: 'cards', icon: <IconCards />, labelEn: 'Cards', labelZh: 'Cards' },
];

function getSectionLabel(tab: RightPanelTab, locale: DesktopLocale): string {
  const item = DIRECTORY_ITEMS.find((entry) => entry.id === tab);
  if (!item) {
    return tab;
  }
  return locale === 'zh-CN' ? item.labelZh : item.labelEn;
}

export function RightPanel(props: RightPanelProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const changesCount = props.changesCount ?? 0;
  const runningProcessCount = props.runningProcessCount ?? 0;
  const cardsDueCount = props.cardsDueCount;
  const terminalAttention = props.terminalAttention === true;
  const listTitle = locale === 'zh-CN' ? '工作区' : 'Workspace';

  // Remember last inner view across collapses (sessionStorage survives unmount).
  const [view, setView] = useState<RightPanelView>(() => readStoredRightPanelView());
  const previousActiveTabRef = useRef(props.activeTab);
  const previousOpenRef = useRef(props.open);

  useEffect(() => {
    writeStoredRightPanelView(view);
    props.onViewChange?.(view);
  }, [view, props.onViewChange]);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = props.open;
    // Re-hydrate from storage when the panel reopens after unmount.
    if (props.open && !wasOpen) {
      setView(readStoredRightPanelView());
    }
  }, [props.open]);

  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    previousActiveTabRef.current = props.activeTab;
    // External tab navigation (run status → Activity, commands) drills into detail.
    if (props.open && previousTab !== props.activeTab) {
      setView('detail');
    }
  }, [props.activeTab, props.open]);

  useEffect(() => {
    // Viewing live terminal clears the directory-row attention pulse.
    if (
      props.open &&
      view === 'detail' &&
      props.activeTab === 'activity' &&
      terminalAttention
    ) {
      props.onTerminalAttentionClear?.();
    }
  }, [
    props.open,
    view,
    props.activeTab,
    terminalAttention,
    props.onTerminalAttentionClear,
  ]);

  const drillInto = (tab: RightPanelTab): void => {
    props.onTabChange(tab);
    setView('detail');
    if (tab === 'activity') {
      props.onTerminalAttentionClear?.();
    }
  };

  const returnHome = (): void => {
    setView('home');
  };

  const inDetail = view === 'detail';
  // Keep-mount when collapsed so PTY / terminal state survives reopen (quiet workbench §3.8.1).
  const panelClass = [
    'right-panel',
    'outward-column',
    props.open ? 'content-expanded' : 'is-collapsed',
    props.isResizing ? 'is-resizing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <aside
      className={panelClass}
      data-testid="right-panel"
      data-content-expanded={props.open ? 'true' : 'false'}
      data-open={props.open ? 'true' : 'false'}
      data-view={view}
      data-terminal-attention={terminalAttention ? 'true' : 'false'}
      aria-label="Workspace panel"
      aria-hidden={props.open ? undefined : true}
      {...(!props.open ? ({ inert: true } as Record<string, boolean>) : {})}
    >
      <div
        className="right-panel-resize-handle"
        data-testid="right-panel-resize-handle"
        role="separator"
        aria-label="Resize workspace panel"
        aria-orientation="vertical"
        aria-valuemin={240}
        aria-valuemax={640}
        aria-valuenow={props.panelWidthPx}
        title="Drag to resize workspace panel. Double-click to reset."
        onPointerDown={props.onResizePointerDown}
        onDoubleClick={props.onResizeReset}
      />

      <header className="right-panel-header">
        {inDetail ? (
          <>
            <IconButton
              label={locale === 'zh-CN' ? '返回目录' : 'Back to directory'}
              data-testid="right-panel-back-btn"
              onClick={returnHome}
            >
              <IconChevronLeft />
            </IconButton>
            <div className="right-panel-header-copy">
              <h2>{getSectionLabel(props.activeTab, locale)}</h2>
            </div>
          </>
        ) : (
          <div className="right-panel-header-copy">
            <span className="right-panel-kicker">{listTitle}</span>
          </div>
        )}
        {props.isOverlayPresentation ? (
          <IconButton
            label={locale === 'zh-CN' ? '关闭工作区面板' : 'Close workspace panel'}
            data-testid="right-panel-close-btn"
            onClick={props.onClose}
          >
            <IconClose />
          </IconButton>
        ) : null}
      </header>

      {!inDetail ? (
        <nav
          className="right-panel-section-list"
          aria-label="Workspace sections"
          data-testid="right-panel-directory"
        >
          <div className="right-panel-group-label" aria-hidden>
            piwin
          </div>
          {DIRECTORY_ITEMS.map((tab) => {
            const label = locale === 'zh-CN' ? tab.labelZh : tab.labelEn;
            const isTerminal = tab.id === 'activity';
            const hasProcess = isTerminal && runningProcessCount > 0;
            const showAttention = isTerminal && terminalAttention;
            const rowClass = [
              'right-panel-section-row',
              hasProcess ? 'has-proc' : '',
              showAttention ? 'has-attention' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <ListRow
                key={tab.id}
                className={rowClass}
                selected={false}
                role="button"
                id={`inspector-tab-${tab.id}`}
                onClick={() => drillInto(tab.id)}
                data-testid={
                  tab.id === 'files'
                    ? 'right-panel-files-btn'
                    : `right-panel-tab-${tab.id}`
                }
              >
                <span className="right-panel-section-icon" aria-hidden>
                  {tab.icon}
                </span>
                {hasProcess ? (
                  <span className="right-panel-section-count is-process">
                    {runningProcessCount}
                  </span>
                ) : null}
                <span className="right-panel-section-label">
                  {label}
                  {tab.hint && locale === 'zh-CN' ? (
                    <span className="right-panel-section-hint">{tab.hint}</span>
                  ) : null}
                </span>
                {tab.hint && locale !== 'zh-CN' ? (
                  <span className="right-panel-section-hint-en">{tab.hint}</span>
                ) : null}
                {tab.id === 'review' && changesCount > 0 ? (
                  <span className="right-panel-section-count is-changes">
                    {changesCount}
                  </span>
                ) : null}
                {tab.id === 'cards' &&
                cardsDueCount !== undefined &&
                cardsDueCount > 0 ? (
                  <span className="right-panel-section-count is-due">
                    {cardsDueCount} due
                  </span>
                ) : null}
                {showAttention ? (
                  <span
                    className="right-panel-section-attention"
                    data-testid="right-panel-terminal-attention"
                    aria-label={
                      locale === 'zh-CN' ? '终端有新输出' : 'New terminal output'
                    }
                  />
                ) : null}
                {hasProcess ? (
                  <span className="right-panel-section-chevron" aria-hidden>
                    <IconChevronRight />
                  </span>
                ) : null}
              </ListRow>
            );
          })}
        </nav>
      ) : (
        <div
          className="right-panel-body"
          role="region"
          id={`inspector-panel-${props.activeTab}`}
          aria-labelledby={`inspector-tab-${props.activeTab}`}
        >
          {props.activeTab === 'files' ? (
            <div className="right-panel-section">{props.filesContent}</div>
          ) : null}
          {props.activeTab === 'activity' ? (
            <div
              className="right-panel-section right-panel-activity"
              data-testid="activity-panel"
            >
              {props.activityContent}
            </div>
          ) : null}
          {props.activeTab === 'review' ? (
            <div className="right-panel-section">{props.reviewContent}</div>
          ) : null}
          {props.activeTab === 'notes' ? (
            <div className="right-panel-section">{props.notesContent}</div>
          ) : null}
          {props.activeTab === 'cards' ? (
            <div className="right-panel-section">{props.cardsContent}</div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
