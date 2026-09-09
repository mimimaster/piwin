/**
 * Right workspace panel — multi-tab like Cursor's side window.
 *
 * - 2x2 home grid: Files / Terminal / Browser / Changes
 * - + opens notes / cards / side chat plus the four home tabs
 * - Drag left edge to resize; double-click resets width
 * - Mount only the active surface; preserve an open terminal as the explicit
 *   PTY-authority exception
 */

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { IconCompress, IconExpand } from './shell-icons';
import { getDesktopCopy } from './desktop-locale';
import type { DesktopLocale } from './desktop-locale';
import { IconButton, IconClose } from '@piwin/ui-kit';
import { readStoredRightPanelState, writeStoredRightPanelState } from './right-panel-memory';
import { sectionLabel, type RightPanelTab } from './right-panel-sections';
import { RightPanelPlusMenu } from './right-panel-plus-menu';
import { RightPanelHome } from './right-panel-home';
import { RightPanelTabs } from './right-panel-tabs.js';
import { RIGHT_PANEL_MAX_WIDTH_PX, RIGHT_PANEL_MIN_WIDTH_PX } from './right-panel-width';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from './native-window-drag';
import { DeferredSurfaceBoundary } from './deferred-desktop-surfaces';

/** @deprecated use presence of open tabs; kept for App attention gating. */
export type RightPanelView = 'home' | 'detail';

export type RightPanelProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  activeTab: RightPanelTab | null;
  onTabChange: (tab: RightPanelTab | null) => void;
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
  sideChatContent?: ReactNode;
  docPreviewContent?: ReactNode;
  changesCount?: number;
  runningJobCount?: number;
  cardsDueCount?: number;
  terminalAttention?: boolean;
  onTerminalAttentionClear?: () => void;
  onViewChange?: (view: RightPanelView) => void;
  locale?: DesktopLocale;
  appearanceMode?: 'light' | 'dark';
  onToggleAppearance?: () => void;
  onOpenSkills?: () => void;
  onOpenMcp?: () => void;
  onOpenSettings?: () => void;
  onToggleSessions?: () => void;
};

export type { RightPanelTab } from './right-panel-sections';

function sectionContent(props: RightPanelProps, tab: RightPanelTab): ReactNode | undefined {
  switch (tab) {
    case 'files':
      return props.filesContent;
    case 'terminal':
      return props.terminalContent;
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
      return props.sideChatContent;
    case 'docPreview':
      return props.docPreviewContent;
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
  return openTabs.filter(
    (tab) => tab === 'terminal' || (panelOpen && activeTab !== null && tab === activeTab),
  );
}

export function RightPanel(props: RightPanelProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const changesCount = props.changesCount ?? 0;
  const runningJobCount = props.runningJobCount ?? 0;
  const cardsDueCount = props.cardsDueCount;
  const terminalAttention = props.terminalAttention === true;

  const initial = useMemo(() => readStoredRightPanelState(), []);
  const [openTabs, setOpenTabs] = useState<RightPanelTab[]>(() => initial.openTabs);
  const [pickerOpen, setPickerOpen] = useState(false);
  const previousActiveTabRef = useRef(props.activeTab);
  const previousOpenRef = useRef(props.open);

  // Sync stored multi-tab state.
  useEffect(() => {
    const requested = props.activeTab;
    writeStoredRightPanelState({
      openTabs,
      activeTab:
        requested != null && openTabs.includes(requested) ? requested : (openTabs[0] ?? null),
    });
    props.onViewChange?.(openTabs.length > 0 ? 'detail' : 'home');
  }, [openTabs, props.activeTab, props.onViewChange]);

  // Panel just opened: an explicit shell request wins over stored navigation.
  // This matters for agent-triggered Canvas/Browser reveals while the panel is
  // collapsed; restoring an old tab first can race the controlled active tab.
  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = props.open;
    if (!props.open || wasOpen) {
      return;
    }
    const stored = readStoredRightPanelState();
    const requested = props.activeTab;
    if (requested != null) {
      setOpenTabs((current) => {
        const base = current.length > 0 ? current : stored.openTabs;
        return base.includes(requested) ? base : [...base, requested];
      });
      setPickerOpen(false);
      return;
    }
    if (stored.openTabs.length > 0) {
      setOpenTabs(stored.openTabs);
      setPickerOpen(false);
      if (stored.activeTab) {
        props.onTabChange(stored.activeTab);
      }
      return;
    }
  }, [props.open, props.activeTab, props.onTabChange]);

  // External tab navigation while open (commands / status) adds a tab.
  useEffect(() => {
    const requested = props.activeTab;
    if (!props.open || requested == null) {
      previousActiveTabRef.current = requested;
      return;
    }
    const previous = previousActiveTabRef.current;
    previousActiveTabRef.current = requested;
    if (previous === requested) {
      return;
    }
    setOpenTabs((current) => (current.includes(requested) ? current : [...current, requested]));
    setPickerOpen(false);
  }, [props.activeTab, props.open]);

  useEffect(() => {
    if (
      props.open &&
      openTabs.includes('terminal') &&
      props.activeTab === 'terminal' &&
      terminalAttention
    ) {
      props.onTerminalAttentionClear?.();
    }
  }, [props.open, openTabs, props.activeTab, terminalAttention, props.onTerminalAttentionClear]);

  function openTab(tab: RightPanelTab): void {
    setOpenTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    props.onTabChange(tab);
    setPickerOpen(false);
    if (tab === 'terminal') {
      props.onTerminalAttentionClear?.();
    }
  }

  function closeTab(tab: RightPanelTab): void {
    setOpenTabs((current) => {
      const next = current.filter((item) => item !== tab);
      if (props.activeTab === tab) {
        const fallback = next[next.length - 1] ?? null;
        props.onTabChange(fallback);
      }
      if (next.length === 0) {
        setPickerOpen(false);
      }
      return next;
    });
  }

  const requested = props.activeTab;
  const active =
    requested != null && openTabs.includes(requested) ? requested : (openTabs[0] ?? null);
  const mountedTabs = selectMountedRightPanelTabs(openTabs, active, props.open);

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
      data-view={openTabs.length > 0 ? 'detail' : 'home'}
      data-terminal-attention={terminalAttention ? 'true' : 'false'}
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
            ? '拖动调整宽度，双击恢复默认'
            : 'Drag to resize. Double-click to reset.'
        }
        onPointerDown={props.onResizePointerDown}
        onDoubleClick={props.onResizeReset}
      />

      {/* Cursor-style tab strip */}
      <div
        className="right-panel-tabstrip right-panel-titlebar-box insp-h"
        data-testid="right-panel-tabstrip"
        data-tauri-drag-region
        onMouseDown={handleNativeWindowDragMouseDown}
      >
        <RightPanelPlusMenu
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          locale={locale}
          openTabs={openTabs}
          onSelect={openTab}
          active={pickerOpen}
        />

        <RightPanelTabs
          tabs={openTabs} active={active} locale={locale}
          changesCount={changesCount} runningJobCount={runningJobCount}
          cardsDueCount={cardsDueCount} terminalAttention={terminalAttention}
          onSelect={openTab} onClose={closeTab}
        />

        <WindowDragRegion
          className="right-panel-titlebar-drag"
          data-testid="right-panel-titlebar-drag"
          aria-label={getDesktopCopy(locale).titlebar.dragWindow}
        />

        <div className="right-panel-actions insp-actions" data-no-window-drag>
          <IconButton
            className={`right-panel-action-btn ib${props.isExpanded ? ' active' : ''}`}
            data-testid="right-panel-expand-btn"
            data-app-shell-workspace-layout-toggle="right-panel"
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
            {props.isExpanded ? <IconCompress /> : <IconExpand />}
          </IconButton>

          <IconButton
            className="right-panel-action-btn ib"
            data-testid="right-panel-open-btn"
            label={locale === 'zh-CN' ? '关闭工作区面板' : 'Close workspace panel'}
            title={locale === 'zh-CN' ? '关闭工作区面板' : 'Close workspace panel'}
            onClick={props.onClose}
          >
            <IconClose width={14} height={14} />
          </IconButton>
        </div>
      </div>

      {/* Proto-00 .tool-context: which session these tools follow. The tab
          strip keeps the expand/close controls, so this row is label-only and
          stays hidden outside the Inkstone themes. */}
      <div className="right-panel-tool-context tool-context" data-testid="right-panel-tool-context">
        <span className="follow-dot" aria-hidden />
        <span className="tool-scope">{locale === 'zh-CN' ? '本次会话' : 'This session'}</span>
      </div>

      {openTabs.length === 0 ? (
        <RightPanelHome locale={locale} onSelect={openTab} />
      ) : (
        /* Active-only lifecycle; terminal remains the explicit PTY exception. */
        <div className="right-panel-bodies">
          {mountedTabs.map((tab) => {
            const content = sectionContent(props, tab);
            const label = sectionLabel(tab, locale);
            return (
              <div
                key={tab}
                className="right-panel-body"
                role="tabpanel"
                hidden={tab !== active}
                id={`inspector-panel-${tab}`}
                data-right-panel-tab={tab}
                data-testid={tab === 'terminal' ? 'terminal-panel' : undefined}
              >
                {content === undefined ? (
                  <div className="right-panel-section">
                    <div className="right-panel-empty muted">
                      {locale === 'zh-CN'
                        ? `${label} 面板尚未实现`
                        : `${label} panel is not yet available.`}
                    </div>
                  </div>
                ) : tab === 'terminal' ? (
                  <div className="right-panel-section right-panel-terminal">
                    <DeferredSurfaceBoundary
                      label={locale === 'zh-CN' ? '正在加载终端' : 'Loading terminal'}
                    >
                      {content}
                    </DeferredSurfaceBoundary>
                  </div>
                ) : (
                  <div className="right-panel-section">
                    <DeferredSurfaceBoundary
                      label={locale === 'zh-CN' ? `正在加载${label}` : `Loading ${label}`}
                    >
                      {content}
                    </DeferredSurfaceBoundary>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
