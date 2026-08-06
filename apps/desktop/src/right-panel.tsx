/**
 * Right workspace panel — multi-tab like Cursor's side window.
 *
 * - 2x2 home grid: Files / Terminal / Browser / Changes
 * - + opens a section picker popover limited to the same four tabs
 * - Drag left edge to resize; double-click resets width
 * - Keep-mounted open tab bodies so PTY survives tab switches
 */

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { IconClose, IconMoon, IconPanelRight, IconSun } from './shell-icons';
import { getDesktopCopy } from './desktop-locale';
import type { DesktopLocale } from './desktop-locale';
import { IconButton } from '@piwin/ui-kit';
import { readStoredRightPanelState, writeStoredRightPanelState } from './right-panel-memory';
import { sectionLabel, sectionIcon, type RightPanelTab } from './right-panel-sections';
import { RightPanelPlusMenu } from './right-panel-plus-menu';
import { RightPanelHome } from './right-panel-home';
import { RIGHT_PANEL_MAX_WIDTH_PX, RIGHT_PANEL_MIN_WIDTH_PX } from './right-panel-width';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from './native-window-drag';

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

  // Panel just opened: restore storage, or open the shell-requested tab once.
  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = props.open;
    if (!props.open || wasOpen) {
      return;
    }
    const stored = readStoredRightPanelState();
    if (stored.openTabs.length > 0) {
      setOpenTabs(stored.openTabs);
      setPickerOpen(false);
      if (stored.activeTab) {
        props.onTabChange(stored.activeTab);
      }
      return;
    }
    // First open this session: only open a tab if the shell explicitly requests one.
    const requested = props.activeTab;
    if (requested != null) {
      setOpenTabs([requested]);
      setPickerOpen(false);
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
        className="right-panel-tabstrip right-panel-titlebar-box"
        data-testid="right-panel-tabstrip"
        role="tablist"
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

        <div className="right-panel-tabs" data-no-window-drag>
          {openTabs.map((tab) => {
            const isActive = tab === active;
            const label = sectionLabel(tab, locale);
            return (
              <div
                key={tab}
                className={isActive ? 'right-panel-tab active' : 'right-panel-tab'}
                role="tab"
                aria-selected={isActive}
                data-testid={`right-panel-open-tab-${tab}`}
              >
                <button
                  type="button"
                  className="right-panel-tab-main"
                  onClick={() => {
                    props.onTabChange(tab);
                    setPickerOpen(false);
                    if (tab === 'terminal') props.onTerminalAttentionClear?.();
                  }}
                >
                  <span className="right-panel-tab-icon" aria-hidden>
                    {sectionIcon(tab)}
                  </span>
                  <span className="right-panel-tab-label">{label}</span>
                  {tab === 'terminal' && runningJobCount > 0 ? (
                    <span className="right-panel-tab-badge">{runningJobCount}</span>
                  ) : null}
                  {tab === 'terminal' && terminalAttention ? (
                    <span className="right-panel-tab-attention" aria-hidden />
                  ) : null}
                  {tab === 'review' && changesCount > 0 ? (
                    <span className="right-panel-tab-badge">{changesCount}</span>
                  ) : null}
                  {tab === 'cards' && cardsDueCount !== undefined && cardsDueCount > 0 ? (
                    <span className="right-panel-tab-badge">{cardsDueCount}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="right-panel-tab-close"
                  aria-label={locale === 'zh-CN' ? `关闭 ${label}` : `Close ${label}`}
                  data-testid={`right-panel-close-tab-${tab}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab);
                  }}
                >
                  <IconClose width={12} height={12} />
                </button>
              </div>
            );
          })}
        </div>

        <WindowDragRegion
          className="right-panel-titlebar-drag"
          data-testid="right-panel-titlebar-drag"
          aria-label={getDesktopCopy(locale).titlebar.dragWindow}
        />

        <div className="right-panel-actions" data-no-window-drag>
          {props.onToggleAppearance ? (
            <IconButton
              className="right-panel-action-btn"
              data-testid="titlebar-theme-toggle"
              label={props.appearanceMode === 'light' ? getDesktopCopy(locale).titlebar.switchToDarkTheme : getDesktopCopy(locale).titlebar.switchToLightTheme}
              title={props.appearanceMode === 'light' ? getDesktopCopy(locale).titlebar.switchToDarkTheme : getDesktopCopy(locale).titlebar.switchToLightTheme}
              aria-pressed={props.appearanceMode === 'dark'}
              onClick={props.onToggleAppearance}
            >
              {props.appearanceMode === 'light' ? <IconMoon /> : <IconSun />}
            </IconButton>
          ) : null}



          <IconButton
            className="right-panel-action-btn active"
            data-testid="right-panel-open-btn"
            label={getDesktopCopy(locale).titlebar.collapseWorkspacePanel}
            title={getDesktopCopy(locale).titlebar.collapseWorkspacePanel}
            aria-pressed={true}
            onClick={props.onClose}
          >
            <IconPanelRight />
          </IconButton>
        </div>

      </div>

      {openTabs.length === 0 ? (
        <RightPanelHome locale={locale} onSelect={openTab} />
      ) : (
        /* Keep all open tab bodies mounted (PTY survives switch). */
        <div className="right-panel-bodies">
          {openTabs.map((tab) => {
            const content = sectionContent(props, tab);
            const label = sectionLabel(tab, locale);
            return (
              <div
                key={tab}
                className="right-panel-body"
                role="tabpanel"
                hidden={tab !== active}
                id={`inspector-panel-${tab}`}
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
                  <div className="right-panel-section right-panel-terminal">{content}</div>
                ) : (
                  <div className="right-panel-section">{content}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
