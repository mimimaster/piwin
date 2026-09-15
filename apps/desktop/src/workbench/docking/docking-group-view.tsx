import type { CSSProperties, ReactElement, RefCallback } from 'react';
import { ConversationPaneEmptyState } from '../../conversation-pane-empty-state.js';
import { IconButton } from '@piwin/ui-kit';
import {
  IconArrowDown,
  IconClose,
  IconCompress,
  IconExpand,
  IconPanelRight,
} from '../../shell-icons.js';
import type { DockViewRenderContext } from './docking-surface-content.js';
import { resolveViewTitle } from './docking-surface-content.js';
import type { DropEdge, DropSource, WorkspaceGroup, WorkspaceState } from './types.js';

const ICON_PX = 14;

export type DockingGroupViewProps = {
  state: WorkspaceState;
  group: WorkspaceGroup;
  rect: { left: number; top: number; width: number; height: number };
  active: boolean;
  hidden: boolean;
  spanStage: boolean;
  showChrome: boolean;
  maximized: boolean;
  splitDisabled: boolean;
  ctx: DockViewRenderContext;
  slotRef: RefCallback<HTMLDivElement>;
  onActivate: () => void;
  onFocusView: (viewId: string) => void;
  onCloseView: (viewId: string) => void;
  onToggleMaximize: () => void;
  onSplit: (edge: DropEdge) => void;
  onStartDrag: (origin: { x: number; y: number }, source: DropSource) => void;
  onCreateSession: () => void;
};

export function DockingGroupView(props: DockingGroupViewProps): ReactElement {
  const { group, state, ctx } = props;
  const isChinese = ctx.locale === 'zh-CN';
  const style: CSSProperties = props.spanStage
    ? { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }
    : {
        position: 'absolute',
        left: `${String(props.rect.left * 100)}%`,
        top: `${String(props.rect.top * 100)}%`,
        width: `${String(props.rect.width * 100)}%`,
        height: `${String(props.rect.height * 100)}%`,
      };

  return (
    <section
      className={`conversation-pane${props.active ? ' is-active' : ''}`}
      style={style}
      hidden={props.hidden}
      data-group-id={group.groupId}
      data-docking-group-active={props.active ? 'true' : 'false'}
      onPointerDownCapture={props.onActivate}
    >
      <div className="conversation-pane-frame">
        {props.showChrome ? (
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
                    data-docking-tab={viewId}
                    data-docking-tab-group={group.groupId}
                    data-docking-tab-index={index}
                    data-tauri-drag-region="false"
                    onClick={() => props.onFocusView(viewId)}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      props.onStartDrag({ x: event.clientX, y: event.clientY }, { kind: 'view', viewId });
                    }}
                  >
                    {resolveViewTitle({ view, sessions: ctx.sessions, locale: ctx.locale })}
                  </button>
                );
              })}
            </div>
            <IconButton
              label={isChinese ? '向右分屏' : 'Split right'}
              className="is-split-action"
              disabled={props.splitDisabled}
              onClick={() => props.onSplit('right')}
            >
              <IconPanelRight width={ICON_PX} height={ICON_PX} />
            </IconButton>
            <IconButton
              label={isChinese ? '向下分屏' : 'Split down'}
              className="is-split-action"
              disabled={props.splitDisabled}
              onClick={() => props.onSplit('down')}
            >
              <IconArrowDown width={ICON_PX} height={ICON_PX} />
            </IconButton>
            <IconButton
              label={
                props.maximized
                  ? isChinese
                    ? '恢复窗格'
                    : 'Restore pane'
                  : isChinese
                    ? '最大化窗格'
                    : 'Maximize pane'
              }
              onClick={props.onToggleMaximize}
            >
              {props.maximized ? (
                <IconCompress width={ICON_PX} height={ICON_PX} />
              ) : (
                <IconExpand width={ICON_PX} height={ICON_PX} />
              )}
            </IconButton>
            {group.activeViewId ? (
              <IconButton
                label={isChinese ? '关闭视图' : 'Close view'}
                onClick={() => {
                  const viewId = group.activeViewId;
                  if (viewId) props.onCloseView(viewId);
                }}
              >
                <IconClose width={ICON_PX} height={ICON_PX} />
              </IconButton>
            ) : null}
          </header>
        ) : null}
        <div className="conversation-pane-body" ref={props.slotRef}>
          {group.activeViewId ? null : (
            <ConversationPaneEmptyState
              paneId={group.groupId}
              creating={false}
              createDisabled={false}
              locale={ctx.locale}
              onCreate={() => props.onCreateSession()}
            />
          )}
        </div>
      </div>
    </section>
  );
}
