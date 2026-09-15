import type { CSSProperties, ReactElement, RefCallback } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconPanelLeft, IconPanelRight } from '../../shell-icons.js';
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
  onToggleCollapsed: () => void;
};

export function DockingRightPanel(props: DockingRightPanelProps): ReactElement {
  const { state, ctx } = props;
  const groupId = state.rightPanel.groupIds[0];
  const group = groupId ? state.groups[groupId] : undefined;
  const isChinese = ctx.locale === 'zh-CN';
  const collapsed = state.rightPanel.collapsed;

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
              if (!view) return null;
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
          <IconButton
            label={isChinese ? '折叠右栏' : 'Collapse right panel'}
            onClick={props.onToggleCollapsed}
          >
            <IconPanelRight width={14} height={14} />
          </IconButton>
        </header>
        <div className="conversation-pane-body" ref={props.slotRef} />
      </div>
    </aside>
  );
}

export function DockingRightPanelRail(props: {
  hidden: boolean;
  locale: 'zh-CN' | 'en';
  onToggleCollapsed: () => void;
}): ReactElement {
  if (props.hidden) return <span hidden />;
  return (
    <div className="docking-right-rail">
      <IconButton
        label={props.locale === 'zh-CN' ? '展开右栏' : 'Expand right panel'}
        onClick={props.onToggleCollapsed}
      >
        <IconPanelLeft width={14} height={14} />
      </IconButton>
    </div>
  );
}
