/**
 * Right workspace panel — multi-tab like Cursor's side window.
 *
 * - Empty home lists the tools; picking one opens its first instance.
 * - + opens another instance of a tool, so two Browsers sit side by side.
 * - Drag left edge to resize; double-click resets width.
 * - Mount only the active surface; preserve an open terminal as the explicit
 *   PTY-authority exception.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { IconCompress, IconExpand, IconRefresh } from '../tool-cards/shell-icons';
import { getDesktopCopy } from '../i18n/desktop-locale';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { IconButton, IconClose } from '@piwin/ui-kit';
import { useRightPanelNavigation } from './use-right-panel-navigation.js';
import {
  allocateRightPanelInstanceId,
  insertTabAfterActive,
  isSingleInstanceKind,
  isTerminalTab,
  rightPanelTabKind,
  sectionLabel,
  type RightPanelTab,
  type RightPanelToolKind,
} from './right-panel-sections';
import { terminalTabLabel } from '../terminal/terminal-tab-label.js';
import { RightPanelPlusMenu } from './right-panel-plus-menu';
import { RightPanelHome } from './right-panel-home';
import { RightPanelTabs } from './right-panel-tabs.js';
import {
  RIGHT_PANEL_SIDE_CHAT_TABS_SLOT_ID,
  RightPanelChromeProvider,
} from './right-panel-chrome.js';
import { SurfaceTitlebarProvider, type SurfaceTitlebar } from '../conversation/surface-titlebar.js';
import { RIGHT_PANEL_MAX_WIDTH_PX, RIGHT_PANEL_MIN_WIDTH_PX } from './right-panel-width';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from '../platform/native-window-drag';
import { DeferredSurfaceBoundary } from '../conversation/deferred-desktop-surfaces';
import type { TerminalSessionsApi } from '../hooks/use-terminal-sessions';

/** @deprecated use presence of open tabs; kept for App attention gating. */
export type RightPanelView = 'home' | 'detail';

/**
 * Tools a docking group owns. They are listed and closed like the panel's own
 * tabs, but their surfaces live in the docking workspace and are placed into
 * one shared body slot, so they can also move onto the stage.
 */
export type RightPanelDockedTools = {
  /** In docking group order. */
  tabs: readonly RightPanelTab[];
  groupId: string | null;
  labels?: Partial<Record<RightPanelTab, string>>;
  onClose: (tab: RightPanelTab) => void;
  slotRef: (node: HTMLElement | null) => void;
  panelRef: (node: HTMLElement | null) => void;
  /** Titlebar slots a docked browser takes over while it is the active tab. */
  onTitlebarChange: (titlebar: SurfaceTitlebar | null) => void;
  /** A selected docked body, not merely an expanded inspector column. */
  onVisibilityChange?: (visible: boolean) => void;
};

export type RightPanelProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  activeTab: RightPanelTab | null;
  onTabChange: (tab: RightPanelTab | null) => void;
  /**
   * Reset selection to the launcher on a conversation/project change, without
   * expanding the panel; omitted: falls back to `onTabChange`.
   */
  onNavigationReset?: ((tab: RightPanelTab | null) => void) | undefined;
  /**
   * The + menu and the empty launcher asked for one more instance of a tool.
   * A host that owns the tool's surface (docking) handles it; otherwise the
   * panel opens the tab itself.
   */
  onOpenInstance?: ((tab: RightPanelTab) => void) | undefined;
  panelWidthPx: number;
  isResizing: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onResizeReset: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  isOverlayPresentation?: boolean;
  filesContent: ReactNode;
  /** Terminal panel body (no context-window chrome). */
  terminalContent: ReactNode;
  /** Browser session panel body (ADR 0020 §6 mirrored frame + pick). */
  browserContent?: ReactNode;
  reviewContent: ReactNode;
  notesContent?: ReactNode;
  cardsContent?: ReactNode;
  canvasContent?: ReactNode;
  /** One side chat per instance tab, so the content is rendered per tab id. */
  sideChatContent?: ReactNode | ((tab: RightPanelTab) => ReactNode);
  /** A tab was closed by the user (side chats end their session on close). */
  onTabClosed?: (tab: RightPanelTab) => void;
  docPreviewContent?: ReactNode;
  tasksContent?: ReactNode;
  /** S07 memory diagnostics surface (compact panel, self-collecting). */
  memoryContent?: ReactNode;
  changesCount?: number;
  runningJobCount?: number;
  cardsDueCount?: number;
  tasksActiveCount?: number;
  onViewChange?: (view: RightPanelView) => void;
  locale?: DesktopLocale;
  appearanceMode?: 'light' | 'dark';
  onToggleAppearance?: () => void;
  onOpenSkills?: () => void;
  onOpenMcp?: () => void;
  onOpenSettings?: () => void;
  onToggleSessions?: () => void;
  /** Tabs another surface owns (docking): never listed, restored, or remembered here. */
  handedOffTabs?: readonly RightPanelTab[];
  dockedTools?: RightPanelDockedTools;
  /** Shared multi-session terminal controller. */
  terminalSessions?: TerminalSessionsApi;
  /** The conversation whose tab layout this panel shows; omitted: one global layout. */
  layoutSessionId?: string | null;
  layoutScopeKey?: string;
};

const NO_HANDED_OFF_TABS: readonly RightPanelTab[] = [];

export type { RightPanelTab } from './right-panel-sections';

function sectionContent(props: RightPanelProps, tab: RightPanelTab): ReactNode | undefined {
  const kind = rightPanelTabKind(tab);
  if (kind === 'terminal') return props.terminalContent;
  switch (kind) {
    case 'files':
      return props.filesContent;
    case 'browser':
      return props.browserContent;
    case 'review':
      return props.reviewContent;
    case 'notes':
      return props.notesContent;
    case 'cards':
      return props.cardsContent;
    case 'canvas':
      return props.canvasContent;
    case 'sideChat':
      return typeof props.sideChatContent === 'function'
        ? props.sideChatContent(tab)
        : props.sideChatContent;
    case 'docPreview':
      return props.docPreviewContent;
    case 'tasks':
      return props.tasksContent;
    case 'memory':
      return props.memoryContent;
    default:
      return undefined;
  }
}

/**
 * Hidden feature surfaces must not retain DOM, listeners, frames, or graphics.
 * Terminal is the sole exception until PTY session authority moves above
 * TerminalDock; unmounting that owner intentionally closes all PTYs.
 */
export function selectMountedRightPanelTabs(
  openTabs: readonly RightPanelTab[],
  activeTab: RightPanelTab | null,
  panelOpen: boolean,
): RightPanelTab[] {
  const terminalTab = openTabs.find(isTerminalTab);
  const result: RightPanelTab[] = [];
  if (terminalTab) {
    result.push(terminalTab);
  }
  for (const tab of openTabs) {
    if (!isTerminalTab(tab) && panelOpen && activeTab !== null && tab === activeTab) {
      result.push(tab);
    }
  }
  return result;
}

export function RightPanel(props: RightPanelProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const changesCount = props.changesCount ?? 0;
  const runningJobCount = props.runningJobCount ?? 0;
  const cardsDueCount = props.cardsDueCount;
  const tasksActiveCount = props.tasksActiveCount ?? 0;
  const terminalSessions = props.terminalSessions;

  const handedOffTabs = props.handedOffTabs ?? NO_HANDED_OFF_TABS;
  const handedOffKey = handedOffTabs.join('|');
  const keepsTab = useCallback((tab: RightPanelTab): boolean =>
    !handedOffTabs.some((owned) => rightPanelTabKind(owned) === rightPanelTabKind(tab)), [handedOffTabs]);
  const dockedTools = props.dockedTools;
  const dockedTabs = dockedTools?.tabs ?? NO_HANDED_OFF_TABS;
  const { openTabs, setOpenTabs, listedTabs, setListedTabs, launcher, setLauncher } = useRightPanelNavigation({
    open: props.open, requestedTab: props.activeTab, sessionId: props.layoutSessionId, scopeKey: props.layoutScopeKey,
    dockedTabs, keepsTab, onTabChange: props.onTabChange,
    onSessionChange: props.onNavigationReset ?? props.onTabChange,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [titlebarTabsSlot, setTitlebarTabsSlot] = useState<HTMLElement | null>(null);
  const [titlebarActionsSlot, setTitlebarActionsSlot] = useState<HTMLElement | null>(null);
  const [browserPageTabCount, setBrowserPageTabCount] = useState(0);
  const availableTabs = useMemo(
    () => [...openTabs, ...dockedTabs.filter((tab) => !openTabs.includes(tab))],
    [dockedTabs, openTabs],
  );
  const allTabs = useMemo(
    () => listedTabs.filter((tab) => availableTabs.includes(tab)), [availableTabs, listedTabs],
  );

  // A tab picked from the menu may be handed off right away; drop it here too.
  useEffect(() => {
    setOpenTabs((current) =>
      current.some((tab) => !keepsTab(tab)) ? current.filter(keepsTab) : current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by handedOffKey
  }, [handedOffKey, openTabs]);

  // Migrate legacy 'terminal' in openTabs to concrete active session id
  const onTerminalTabResolved = props.onTabChange;
  useEffect(() => {
    if (!terminalSessions || terminalSessions.sessions.length === 0) return;
    const targetSessionId = terminalSessions.activeSessionId ?? terminalSessions.sessions[0]?.id;
    if (!targetSessionId) return;
    setOpenTabs((current) => {
      if (current.includes('terminal')) {
        return current.map((t) => (t === 'terminal' ? (targetSessionId as RightPanelTab) : t));
      }
      return current;
    });
    setListedTabs((current) => current.includes('terminal')
      ? [...new Set(current.map((tab) => tab === 'terminal' ? targetSessionId as RightPanelTab : tab))]
      : current);
    // A cold, on-demand terminal can arrive after the generic request was
    // added. Resolve the controlled selection too, or an older tab wins.
    if (props.activeTab === 'terminal') onTerminalTabResolved(targetSessionId as RightPanelTab);
  }, [onTerminalTabResolved, props.activeTab, setListedTabs, setOpenTabs, terminalSessions]);

  // Sessions opened outside the + menu (terminal sidebar) still need a tab.
  // The + menu inserts its own tab first, so an id already listed stays put
  // instead of being pulled to the end.
  // Keyed by the terminal's own active id only: a tab switch (or a session
  // switch restoring another layout) must not pull the terminal back in.
  const previousTerminalIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!terminalSessions) return;
    const activeId = terminalSessions.activeSessionId;
    const previous = previousTerminalIdRef.current;
    if (previous === activeId) return;
    previousTerminalIdRef.current = activeId;
    if (activeId) {
      // Existing sessions are owners, not automatic navigation. A new one
      // created inside the visible terminal can still appear (for example ⌘T).
      if (previous !== undefined && !launcher && isTerminalTab(props.activeTab)) setListedTabs((current) =>
        current.includes(activeId as RightPanelTab) ? current : [...current, activeId as RightPanelTab]);
      setOpenTabs((current) =>
        current.includes(activeId as RightPanelTab)
          ? current
          : [...current, activeId as RightPanelTab],
      );
    }
  }, [launcher, props.activeTab, setListedTabs, setOpenTabs, terminalSessions?.activeSessionId]);

  // Remove closed terminal sessions from openTabs
  useEffect(() => {
    if (!terminalSessions) return;
    const validSessionIds = new Set(terminalSessions.sessions.map((s) => s.id));
    setOpenTabs((current) => {
      const next = current.filter((t) => !isTerminalTab(t) || t === 'terminal' || validSessionIds.has(t));
      if (next.length !== current.length) {
        return next;
      }
      return current;
    });
  }, [terminalSessions?.sessions]);

  const revealTab = useCallback((tab: RightPanelTab, place: 'after-active' | 'end' = 'end'): void => {
    if (isTerminalTab(tab) && terminalSessions && tab !== 'terminal') {
      terminalSessions.setActiveSessionId(tab);
    }
    if (keepsTab(tab)) {
      setOpenTabs((current) =>
        current.includes(tab) ? current : [...current, tab],
      );
    }
    setListedTabs((current) => place === 'after-active'
      ? insertTabAfterActive(current, tab, props.activeTab)
      : current.includes(tab) ? current : [...current, tab]);
    setLauncher(false);
    props.onTabChange(tab);
    setPickerOpen(false);
  }, [keepsTab, props, setLauncher, setListedTabs, setOpenTabs, terminalSessions]);

  /** + menu and the empty-state launcher: another instance, except single-instance views. */
  const openKind = useCallback((kind: RightPanelToolKind): void => {
    if (kind === 'terminal' && terminalSessions) {
      if (allTabs.length === 0 && terminalSessions.sessions.length > 0) {
        const resumed = terminalSessions.sessions.find((session) => session.id === terminalSessions.activeSessionId)
          ?? terminalSessions.sessions[0];
        if (resumed !== undefined) {
          revealTab(resumed.id as RightPanelTab);
          terminalSessions.setActiveSessionId(resumed.id);
          setPickerOpen(false);
          return;
        }
      }
      const created = terminalSessions.addSession();
      if (created) {
        revealTab(created.id as RightPanelTab, 'after-active');
        return;
      }
    }
    const id = (
      isSingleInstanceKind(kind) ? kind : allocateRightPanelInstanceId(kind, availableTabs)
    ) as RightPanelTab;
    if (props.onOpenInstance && !keepsTab(id)) {
      props.onOpenInstance(id);
      setPickerOpen(false);
      return;
    }
    revealTab(id, 'after-active');
  }, [allTabs, availableTabs, keepsTab, props, revealTab, terminalSessions]);

  const closeTab = useCallback((tab: RightPanelTab): void => {
    props.onTabClosed?.(tab);
    if (isTerminalTab(tab) && terminalSessions && tab !== 'terminal') {
      terminalSessions.closeSession(tab);
    }
    const remaining = allTabs.filter((item) => item !== tab);
    setListedTabs(remaining);
    if (props.activeTab === tab) {
      props.onTabChange(remaining[remaining.length - 1] ?? null);
    }
    if (remaining.length === 0) {
      setPickerOpen(false);
    }
    if (dockedTabs.includes(tab)) {
      dockedTools?.onClose(tab);
      return;
    }
    setOpenTabs((current) => current.filter((item) => item !== tab));
  }, [allTabs, dockedTabs, dockedTools, props, setListedTabs, setOpenTabs, terminalSessions]);

  const requested = props.activeTab;
  const active =
    requested != null && allTabs.includes(requested) ? requested : (allTabs[0] ?? null);
  const showHome = launcher || allTabs.length === 0;
  const onViewChange = props.onViewChange;
  useEffect(() => { onViewChange?.(showHome ? 'home' : 'detail'); }, [onViewChange, showHome]);
  const activeKind = active ? rightPanelTabKind(active) : null;
  const activeIsDocked = !showHome && active !== null && !openTabs.includes(active) && dockedTabs.includes(active);
  const onDockedVisibilityChange = dockedTools?.onVisibilityChange;
  useEffect(() => {
    onDockedVisibilityChange?.(props.open && activeIsDocked);
    return () => onDockedVisibilityChange?.(false);
  }, [activeIsDocked, onDockedVisibilityChange, props.open]);
  const mountedTabs = selectMountedRightPanelTabs(openTabs, showHome ? null : active, props.open && !showHome);
  // Tool tabs stay in the strip. Page tabs (side chats, browser pages) used to
  // replace them; a second Browser then had nothing to sit beside.
  const browserTitlebar =
    activeKind === 'browser' && (activeIsDocked || props.browserContent !== undefined);

  const isTerminalActive = isTerminalTab(active);
  const activeTerminalSessionId =
    terminalSessions?.activeSessionId ??
    (isTerminalTab(active) && active !== 'terminal' ? active : null) ??
    terminalSessions?.sessions[0]?.id ??
    null;

  const terminalLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    if (terminalSessions) {
      for (const session of terminalSessions.sessions) {
        labels[session.id as RightPanelTab] = terminalTabLabel(session.title, session.name);
      }
    }
    return labels;
  }, [terminalSessions?.sessions]);

  const handleSelectTab = useCallback(
    (tab: RightPanelTab) => {
      revealTab(tab);
    },
    [revealTab],
  );

  const closeTabRef = useRef<(tab: RightPanelTab) => void>(closeTab);
  closeTabRef.current = closeTab;
  const closeBrowserHost = useCallback(() => {
    const current = activeKind === 'browser' ? active : null;
    if (current) closeTabRef.current(current);
  }, [active, activeKind]);
  const surfaceTitlebarValue = useMemo<SurfaceTitlebar>(
    () => ({
      tabsSlot: titlebarTabsSlot,
      actionsSlot: titlebarActionsSlot,
      setPageTabCount: setBrowserPageTabCount,
      closeHost: closeBrowserHost,
    }),
    [closeBrowserHost, titlebarActionsSlot, titlebarTabsSlot],
  );

  const onDockedTitlebarChange = dockedTools?.onTitlebarChange;
  const dockedBrowserTitlebar = browserTitlebar && activeIsDocked;
  useEffect(() => {
    if (!onDockedTitlebarChange) return;
    onDockedTitlebarChange(dockedBrowserTitlebar ? surfaceTitlebarValue : null);
    return () => onDockedTitlebarChange(null);
  }, [dockedBrowserTitlebar, onDockedTitlebarChange, surfaceTitlebarValue]);

  const panelClass = [
    'right-panel',
    'outward-column',
    props.open ? 'content-expanded' : 'is-collapsed',
    props.isResizing ? 'is-resizing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <RightPanelChromeProvider closeTab={closeTab}>
    <aside
      ref={dockedTools?.panelRef}
      className={panelClass}
      data-testid="right-panel"
      data-content-expanded={props.open ? 'true' : 'false'}
      data-open={props.open ? 'true' : 'false'}
      data-view={showHome ? 'home' : 'detail'}
      aria-label={locale === 'zh-CN' ? '工作区面板' : 'Workspace panel'}
      aria-hidden={props.open ? undefined : true}
      {...(!props.open ? ({ inert: true } as Record<string, boolean>) : {})}
    >
      <div
        className="right-panel-resize-handle"
        data-testid="right-panel-resize-handle"
        role="separator"
        aria-label={locale === 'zh-CN' ? '调整工作区面板宽度' : 'Resize workspace panel'}
        aria-orientation="vertical"
        aria-valuemin={RIGHT_PANEL_MIN_WIDTH_PX}
        aria-valuemax={RIGHT_PANEL_MAX_WIDTH_PX}
        aria-valuenow={props.panelWidthPx}
        title={
          locale === 'zh-CN'
            ? '拖动调整宽度；拉到最窄后再拉可关闭。双击恢复默认'
            : 'Drag to resize. Drag past the minimum to close. Double-click to reset.'
        }
        onPointerDown={props.onResizePointerDown}
        onDoubleClick={props.onResizeReset}
      />

      {/* Cursor-style tab strip: one tab per open instance. */}
      <div
        className={`right-panel-tabstrip right-panel-titlebar-box insp-h${browserTitlebar ? ' has-browser-actions' : ''}${isTerminalActive && terminalSessions ? ' has-terminal-actions' : ''}`}
        data-testid="right-panel-tabstrip"
        data-tauri-drag-region
        onMouseDown={handleNativeWindowDragMouseDown}
      >
        <RightPanelPlusMenu
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            locale={locale}
            onSelect={openKind}
            active={pickerOpen}
        />

        {!showHome && allTabs.length > 0 ? (
          <RightPanelTabs
            tabs={allTabs}
            active={active}
            locale={locale}
            changesCount={changesCount}
            runningJobCount={runningJobCount}
            cardsDueCount={cardsDueCount}
            tasksActiveCount={tasksActiveCount}
            labels={{ ...dockedTools?.labels, ...terminalLabels }}
            {...(dockedTools?.groupId
              ? { dockedGroup: { groupId: dockedTools.groupId, tabs: dockedTabs } }
              : {})}
            onSelect={handleSelectTab}
            onClose={closeTab}
          />
        ) : null}

        {/* Kept for the docked browser, which still portals its page tabs here.
            Hidden: the tool strip above is the instance list. */}
        <div
          id={RIGHT_PANEL_SIDE_CHAT_TABS_SLOT_ID}
          ref={setTitlebarTabsSlot}
          className="right-panel-side-chat-tabs-slot"
          data-testid="right-panel-side-chat-tabs-slot"
          data-no-window-drag
          hidden
        />

        <WindowDragRegion
          className="right-panel-titlebar-drag"
          data-testid="right-panel-titlebar-drag"
          aria-label={getDesktopCopy(locale).titlebar.dragWindow}
        />

        <div className="right-panel-actions insp-actions" data-no-window-drag>
          <div
            ref={setTitlebarActionsSlot}
            className="right-panel-surface-actions-slot"
            data-testid="right-panel-surface-actions-slot"
            hidden={!browserTitlebar}
          />

          {isTerminalActive && terminalSessions ? (
            <IconButton
              className="right-panel-action-btn ib"
              data-testid="pty-restart-btn"
              size={22}
              label={locale === 'zh-CN' ? '重启当前终端' : 'Restart active terminal'}
              title={locale === 'zh-CN' ? '重启当前终端' : 'Restart active terminal'}
              onClick={() => {
                if (activeTerminalSessionId) {
                  terminalSessions.restartSession(activeTerminalSessionId);
                }
              }}
            >
              <IconRefresh width={14} height={14} />
            </IconButton>
          ) : null}

          {/* An empty panel cannot cover the conversation, so it offers no expand. */}
          {(!showHome && allTabs.length > 0) || props.isExpanded ? (
            <IconButton
              className={`right-panel-action-btn ib${props.isExpanded ? ' active' : ''}`}
              data-testid="right-panel-expand-btn"
              data-app-shell-workspace-layout-toggle="right-panel"
              size={22}
              label={
                props.isExpanded
                  ? locale === 'zh-CN'
                    ? '退出全屏'
                    : 'Exit full screen'
                  : locale === 'zh-CN'
                    ? '进入全屏'
                    : 'Enter full screen'
              }
              title={
                props.isExpanded
                  ? locale === 'zh-CN'
                    ? '退出全屏'
                    : 'Exit full screen'
                  : locale === 'zh-CN'
                    ? '进入全屏'
                    : 'Enter full screen'
              }
              aria-pressed={props.isExpanded ?? false}
              onClick={() => {
                if (props.onToggleExpand) {
                  props.onToggleExpand();
                } else {
                  props.onResizeReset();
                }
              }}
            >
              {props.isExpanded ? (
                <IconCompress width={14} height={14} />
              ) : (
                <IconExpand width={14} height={14} />
              )}
            </IconButton>
          ) : null}

          {browserTitlebar && !props.isOverlayPresentation && browserPageTabCount === 0 && active ? (
            <IconButton
              className="right-panel-action-btn ib"
              data-testid="right-panel-close-browser-btn"
              size={22}
              label={locale === 'zh-CN' ? '关闭浏览器' : 'Close browser'}
              title={locale === 'zh-CN' ? '关闭浏览器' : 'Close browser'}
              onClick={() => closeTab(active)}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          ) : null}

          {props.isOverlayPresentation ? (
            <IconButton
              className="right-panel-action-btn ib"
              data-testid="right-panel-close-btn"
              size={22}
              label={locale === 'zh-CN' ? '关闭工作区面板' : 'Close workspace panel'}
              title={locale === 'zh-CN' ? '关闭工作区面板' : 'Close workspace panel'}
              onClick={props.onClose}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          ) : null}
        </div>
      </div>

      {showHome ? (
        <RightPanelHome
          locale={locale}
          onSelect={openKind}
          tasksActiveCount={tasksActiveCount}
        />
      ) : null}
      {/* Terminal ownership survives the launcher and generic panel reopen. */}
      <div className="right-panel-bodies" hidden={showHome}>
          {mountedTabs.map((tab) => {
            const content = sectionContent(props, tab);
            const label = sectionLabel(tab, locale);
            const isTerminal = isTerminalTab(tab);
            const isHidden = isTerminal ? !isTerminalTab(active) : tab !== active;
            return (
              <div
                key={tab}
                className="right-panel-body"
                role="tabpanel"
                hidden={isHidden}
                id={`inspector-panel-${tab}`}
                data-right-panel-tab={tab}
                data-testid={isTerminal ? 'terminal-panel' : undefined}
              >
                {content === undefined ? (
                  <div className="right-panel-section">
                    <div className="right-panel-empty muted">
                      {locale === 'zh-CN'
                        ? `${label} 面板尚未实现`
                        : `${label} panel is not yet available.`}
                    </div>
                  </div>
                ) : isTerminal ? (
                  <div className="right-panel-section right-panel-terminal">
                    <DeferredSurfaceBoundary
                      label={locale === 'zh-CN' ? '正在加载终端' : 'Loading terminal'}
                    >
                      {content}
                    </DeferredSurfaceBoundary>
                  </div>
                ) : (
                  <div className="right-panel-section">
                    <SurfaceTitlebarProvider
                      value={rightPanelTabKind(tab) === 'browser' && browserTitlebar ? surfaceTitlebarValue : null}
                    >
                      <DeferredSurfaceBoundary
                        label={locale === 'zh-CN' ? `正在加载${label}` : `Loading ${label}`}
                      >
                        {content}
                      </DeferredSurfaceBoundary>
                    </SurfaceTitlebarProvider>
                  </div>
                )}
              </div>
            );
          })}
          {dockedTools && dockedTabs.length > 0 ? (
            <div
              ref={dockedTools.slotRef}
              className="right-panel-body"
              role="tabpanel"
              hidden={!activeIsDocked}
              {...(activeIsDocked ? { id: `inspector-panel-${active}` } : {})}
              data-right-panel-docked="true"
              data-testid="right-panel-docked-body"
            />
          ) : null}
      </div>
    </aside>
    </RightPanelChromeProvider>
  );
}
