import type { CSSProperties, ReactElement, RefCallback } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconClose } from '../../shell-icons.js';
import { DEFAULT_RIGHT_PANEL_WIDTH_PX } from './constants.js';
import type { DockViewRenderContext } from './docking-surface-content.js';
import { resolveViewTitle } from './docking-surface-content.js';
import type { WorkspaceState } from './types.js';

export type DockingRightPanelProps = {
  state: WorkspaceState;
  ctx: DockViewRenderContext;
  slotRef: RefCallback<HTMLDivElement>;
  panelRef: RefCallback<HTMLDivElement>;
  onFocusView: (viewId: string) => void;
  onCloseView: (viewId: string) => void;
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

  if (!group || group.viewIds.length === 0) return <div ref={props.panelRef} hidden />;

  const width = collapsed ? 0 : state.rightPanel.width || DEFAULT_RIGHT_PANEL_WIDTH_PX;
  const style: CSSProperties = { width: `${String(width)}px` };

  return (
    <aside className="docking-right-panel" style={style} data-docking-right-panel="true">
      <div className="docking-right-panel-inner" ref={props.panelRef}>
        <header className="conversation-pane-header">
          <div className="conversation-pane-tabs" role="tablist">
            {group.viewIds.map((viewId, index) => {
              const view = state.views[viewId];
              // Its page tabs render in the slot below instead of one tool tab.
              if (!view || viewId === titlebarViewId) return null;
              const isActive = viewId === group.activeViewId;
              return (
                <button
                  key={viewId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`conversation-pane-tab${isActive ? ' is-active' : ''}`}
                  data-docking-right-tab={viewId}
                  data-docking-right-tab-group={group.groupId}
                  data-docking-right-tab-index={index}
                  onClick={() => props.onFocusView(viewId)}
                >
                  {resolveViewTitle({ view, sessions: ctx.sessions, locale: ctx.locale })}
                </button>
              );
            })}
          </div>
          <div
            ref={props.titlebarTabsSlotRef}
            className="docking-right-panel-surface-tabs"
            data-testid="docking-right-panel-surface-tabs"
            hidden={titlebarViewId === null}
          />
          <div className="docking-right-panel-header-spacer" />
          <div
            ref={props.titlebarActionsSlotRef}
            className="docking-right-panel-surface-actions"
            data-testid="docking-right-panel-surface-actions"
            hidden={titlebarViewId === null}
          />
          {titlebarViewId ? (
            <IconButton
              label={isChinese ? '关闭浏览器' : 'Close browser'}
              data-testid="docking-right-panel-close-surface"
              onClick={() => props.onCloseView(titlebarViewId)}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          ) : null}
        </header>
        <div className="conversation-pane-body" ref={props.slotRef} />
      </div>
    </aside>
  );
}
