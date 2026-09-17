import { useRef, useState, type CSSProperties, type PointerEvent, type ReactElement, type RefCallback } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconClose, IconDownload } from '../../shell-icons.js';
import { artifactDownloadLabel, downloadArtifactSource } from '../../artifact-source-export.js';
import { DEFAULT_RIGHT_PANEL_WIDTH_PX, STAGE_SESSION_MIN } from './constants.js';
import { useDockToolHosts } from './dock-tool-hosts.js';
import type { DockViewRenderContext } from './docking-surface-content.js';
import { resolveViewIcon, resolveViewTitle } from './docking-surface-content.js';
import type { WorkspaceState } from './types.js';

const RIGHT_PANEL_MIN_WIDTH_PX = 280;
const HEADER_ICON_BUTTON_PX = 22;

/** Keep the panel usable and leave the stage room for one session. */
function clampDockingRightPanelWidth(widthPx: number, rowWidthPx: number): number {
  const max = Math.max(RIGHT_PANEL_MIN_WIDTH_PX, rowWidthPx - STAGE_SESSION_MIN.width);
  return Math.round(Math.min(max, Math.max(RIGHT_PANEL_MIN_WIDTH_PX, widthPx)));
}

export type DockingRightPanelProps = {
  state: WorkspaceState;
  ctx: DockViewRenderContext;
  slotRef: RefCallback<HTMLDivElement>;
  panelRef: RefCallback<HTMLDivElement>;
  onFocusView: (viewId: string) => void;
  onCloseView: (viewId: string) => void;
  /** Commit a dragged (or reset) panel width. */
  onResizeWidth: (widthPx: number) => void;
  /** Active view that owns the header (browser page tabs), if any. */
  titlebarViewId?: string | null;
  titlebarTabsSlotRef?: RefCallback<HTMLDivElement>;
  titlebarActionsSlotRef?: RefCallback<HTMLDivElement>;
};

export function DockingRightPanel(props: DockingRightPanelProps): ReactElement {
  const { state, ctx } = props;
  const groupId = state.rightPanel.groupIds[0];
  const group = groupId ? state.groups[groupId] : undefined;
  const isChinese = ctx.locale === 'zh-CN';
  const collapsed = state.rightPanel.collapsed;
  const titlebarViewId = props.titlebarViewId ?? null;
  const canvasTarget = useDockToolHosts()?.artifactTarget ?? null;
  const canvasTitle = canvasTarget?.title ?? null;
  const asideRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; rowWidth: number; width: number } | null>(
    null,
  );
  const [resizing, setResizing] = useState(false);

  if (!group || group.viewIds.length === 0) return <div ref={props.panelRef} hidden />;

  const width = collapsed ? 0 : state.rightPanel.width || DEFAULT_RIGHT_PANEL_WIDTH_PX;
  const style: CSSProperties = { width: `${String(width)}px` };
  const closeViewId = titlebarViewId ?? group.activeViewId;
  const activeKind = group.activeViewId ? state.views[group.activeViewId]?.kind : undefined;
  const downloadTarget =
    activeKind === 'canvas' && canvasTarget && canvasTarget.source.trim().length > 0 ? canvasTarget : null;
  const downloadKind = downloadTarget?.type === 'svg' ? 'svg' : 'html';
  const closeLabel = titlebarViewId
    ? isChinese
      ? '关闭浏览器'
      : 'Close browser'
    : isChinese
      ? '关闭标签'
      : 'Close tab';

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const aside = asideRef.current;
    if (event.button !== 0 || !aside) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = aside.getBoundingClientRect().width;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      rowWidth: aside.parentElement?.getBoundingClientRect().width ?? window.innerWidth,
      width: startWidth,
    };
    setResizing(true);
  };
  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const aside = asideRef.current;
    if (!drag || !aside || drag.pointerId !== event.pointerId) return;
    // Dragging the left edge: moving left widens the panel.
    drag.width = clampDockingRightPanelWidth(drag.startWidth + drag.startX - event.clientX, drag.rowWidth);
    aside.style.width = `${String(drag.width)}px`;
  };
  const onResizePointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setResizing(false);
    props.onResizeWidth(drag.width);
  };

  return (
    <aside
      ref={asideRef}
      className={`docking-right-panel${resizing ? ' is-resizing' : ''}`}
      style={style}
      data-docking-right-panel="true"
    >
      {collapsed ? null : (
        <div
          className="docking-right-panel-resize-handle"
          data-testid="docking-right-panel-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={isChinese ? '调整工具栏宽度' : 'Resize tool panel'}
          title={isChinese ? '拖动调整宽度，双击恢复默认' : 'Drag to resize. Double-click to reset.'}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
          onDoubleClick={() => props.onResizeWidth(DEFAULT_RIGHT_PANEL_WIDTH_PX)}
        />
      )}
      <div className="docking-right-panel-inner" ref={props.panelRef}>
        <header className="conversation-pane-header docking-right-panel-header">
          <div className="conversation-pane-tabs docking-right-panel-tabs" role="tablist">
            {group.viewIds.map((viewId, index) => {
              const view = state.views[viewId];
              if (!view) return null;
              const isActive = viewId === group.activeViewId;
              const title = resolveViewTitle({ view, sessions: ctx.sessions, locale: ctx.locale, canvasTitle });
              return (
                <button
                  key={viewId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  title={title}
                  className={`conversation-pane-tab docking-right-panel-tab${isActive ? ' is-active' : ''}`}
                  data-docking-right-tab={viewId}
                  data-docking-right-tab-group={group.groupId}
                  data-docking-right-tab-index={index}
                  onClick={() => props.onFocusView(viewId)}
                >
                  {resolveViewIcon(view.kind)}
                  <span className="docking-right-panel-tab-label">{title}</span>
                </button>
              );
            })}
          </div>
          <div className="docking-right-panel-header-spacer" />
          {downloadTarget ? (
            <IconButton
              label={artifactDownloadLabel(ctx.locale, downloadKind)}
              size={HEADER_ICON_BUTTON_PX}
              data-testid="docking-right-panel-canvas-download"
              onClick={() =>
                void downloadArtifactSource({
                  source: downloadTarget.source,
                  title: downloadTarget.title,
                  kind: downloadKind,
                })
              }
            >
              <IconDownload width={12} height={12} />
            </IconButton>
          ) : null}
          {closeViewId ? (
            <IconButton
              label={closeLabel}
              size={HEADER_ICON_BUTTON_PX}
              data-testid="docking-right-panel-close-surface"
              onClick={() => props.onCloseView(closeViewId)}
            >
              <IconClose width={12} height={12} />
            </IconButton>
          ) : null}
        </header>
        {/* The active browser's page tabs and toolbar get their own row under
            the tool tabs, so switching tools never hides the Browser tab. */}
        <div className="docking-right-panel-surface-bar" hidden={titlebarViewId === null}>
          <div
            ref={props.titlebarTabsSlotRef}
            className="docking-right-panel-surface-tabs"
            data-testid="docking-right-panel-surface-tabs"
          />
          <div className="docking-right-panel-header-spacer" />
          <div
            ref={props.titlebarActionsSlotRef}
            className="docking-right-panel-surface-actions"
            data-testid="docking-right-panel-surface-actions"
          />
        </div>
        <div className="conversation-pane-body" ref={props.slotRef} />
      </div>
    </aside>
  );
}
