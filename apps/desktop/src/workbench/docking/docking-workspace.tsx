import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { STAGE_GROUP_HARD_LIMIT } from './constants.js';
import {
  applyWorkspaceTemplate,
  closeView,
  openSessionView,
  reopenLastView,
  setSplitRatio,
  splitGroupAtEdge,
} from './commands.js';
import { listStageRects, listStageSeparatorRects } from './geometry.js';
import { focusView, maximizeGroup, setDisplayMode } from './identity.js';
import { listStageGroupIds } from './topology.js';
import type { Point, Rect } from './drag-hit-test.js';
import type { DockDragResolution } from './use-docking-drag.js';
import { useDockingDrag } from './use-docking-drag.js';
import { DockingDragOverlay } from './docking-drag-overlay.js';
import { DockingGroupView } from './docking-group-view.js';
import { DockingRightPanel, DockingRightPanelRail } from './docking-right-panel.js';
import { DockingSeparator } from './docking-separator.js';
import { resolveDockDrag } from './docking-drop-resolver.js';
import { DockViewContent, type DockViewRenderContext } from './docking-surface-content.js';
import { placeSurfaceHosts, useDockingSurfaceHosts } from './surface-pool.js';
import type { DockingWorkspaceController } from './use-docking-workspace.js';
import type { WorkspaceGroup, WorkspaceTemplate } from './types.js';

export type DockingWorkspaceProps = Omit<DockViewRenderContext, 'onCloseView'> & {
  controller: DockingWorkspaceController;
  phoneSinglePane?: boolean;
};

const TEMPLATES: WorkspaceTemplate[] = ['single', 'columns', 'rows', 'quad'];

function groupRectOf(state: Parameters<typeof listStageRects>[0], groupId: string, size: { width: number; height: number }): Rect | null {
  const found = listStageRects(state, { left: 0, top: 0, width: size.width, height: size.height }).find(
    (item) => item.groupId === groupId,
  );
  return found ? { left: found.left, top: found.top, width: found.width, height: found.height } : null;
}

export function DockingWorkspace(props: DockingWorkspaceProps): ReactElement {
  const { controller, locale } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const poolRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const [stagePx, setStagePx] = useState({ width: 1200, height: 800 });
  const phoneSinglePane = props.phoneSinglePane === true;
  const state = controller.state;
  const stateRef = useRef(state);
  stateRef.current = state;

  const viewIds = useMemo(() => Object.keys(state.views).sort(), [state.views]);
  const hosts = useDockingSurfaceHosts(viewIds);
  const stageGroupIds = listStageGroupIds(state.stage);
  const usesFullStage =
    phoneSinglePane || state.displayMode === 'focused' || state.displayMode === 'maximized';
  const soloGroupId = state.displayMode === 'maximized' ? state.maximizedGroupId : state.activeGroupId;
  const multiple = stageGroupIds.length > 1 && !phoneSinglePane && state.displayMode !== 'focused';

  const isGroupVisible = useCallback(
    (groupId: string): boolean => {
      if (phoneSinglePane) return groupId === state.activeGroupId;
      if (state.displayMode === 'focused') return groupId === state.activeGroupId;
      if (state.displayMode === 'maximized') return groupId === state.maximizedGroupId;
      return true;
    },
    [phoneSinglePane, state.activeGroupId, state.displayMode, state.maximizedGroupId],
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStagePx({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (phoneSinglePane && state.displayMode !== 'focused') {
      controller.setState((current) => setDisplayMode(current, 'focused'));
    }
  }, [controller, phoneSinglePane, state.displayMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 't') return;
      event.preventDefault();
      controller.setState((current) => {
        const result = reopenLastView(current, controller.createId);
        return result.ok ? result.state : current;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);

  const ctx: DockViewRenderContext = {
    sessions: props.sessions,
    hostClient: props.hostClient,
    activeTheme: props.activeTheme,
    artifactThemeKey: props.artifactThemeKey,
    artifactPreviewEnabled: props.artifactPreviewEnabled,
    readMedia: props.readMedia,
    locale,
    onCreateConversation: props.onCreateConversation,
    onCloseView: (viewId) => controller.setState((current) => closeView(current, viewId)),
    ...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {}),
    ...(props.onOpenArtifactCanvas ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas } : {}),
    ...(props.fileBrowseRoot !== undefined ? { fileBrowseRoot: props.fileBrowseRoot } : {}),
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const rightGroupId = state.rightPanel.groupIds[0];
  const rightGroup: WorkspaceGroup | undefined = rightGroupId ? state.groups[rightGroupId] : undefined;
  const rightPanelVisible = Boolean(
    rightGroup && rightGroup.viewIds.length > 0 && !state.rightPanel.collapsed,
  );

  const pxRects = useMemo(() => {
    if (usesFullStage) {
      if (!soloGroupId) return [];
      const rect = groupRectOf(state, soloGroupId, stagePx);
      return rect ? [{ groupId: soloGroupId, ...rect }] : [];
    }
    return listStageRects(state, { left: 0, top: 0, width: stagePx.width, height: stagePx.height });
  }, [soloGroupId, stagePx, state, usesFullStage]);

  useEffect(() => {
    const current = stateRef.current;
    const placement = new Map<string, HTMLElement>();
    for (const groupId of listStageGroupIds(current.stage)) {
      const group = current.groups[groupId];
      const slot = slotRefs.current.get(groupId);
      if (!slot || !group?.activeViewId || !isGroupVisible(groupId)) continue;
      placement.set(group.activeViewId, slot);
    }
    const activeRightId = current.rightPanel.groupIds[0];
    const right = activeRightId ? current.groups[activeRightId] : undefined;
    const rightSlot = activeRightId ? slotRefs.current.get(activeRightId) : null;
    if (rightSlot && right?.activeViewId && !current.rightPanel.collapsed && right.viewIds.length > 0) {
      placement.set(right.activeViewId, rightSlot);
    }
    placeSurfaceHosts({ hosts, pool: poolRef.current, placement: { viewToSlot: placement } });
  });

  const resolve = useCallback(
    (point: Point, source: Parameters<typeof resolveDockDrag>[0]['source']): DockDragResolution | null => {
      const root = rootRef.current;
      if (!root) return null;
      return resolveDockDrag({
        state: stateRef.current,
        source,
        point,
        root,
        stageSize: { width: stagePx.width, height: stagePx.height },
        groupRects: pxRects,
        panelElement: rightPanelRef.current,
        rightPanelVisible,
        createId: controller.createId,
        apply: (next) => controller.setState(() => next),
      });
    },
    [controller, pxRects, rightPanelVisible, stagePx.height, stagePx.width],
  );

  const { drag, startDrag } = useDockingDrag({
    enabled: true,
    resolve,
    onCommit: (commit) => commit(),
  });

  const templateLabel: Record<WorkspaceTemplate, string> = {
    single: locale === 'zh-CN' ? '单窗' : 'Single',
    columns: locale === 'zh-CN' ? '左右' : 'Columns',
    rows: locale === 'zh-CN' ? '上下' : 'Rows',
    quad: locale === 'zh-CN' ? '四宫格' : 'Quad',
  };

  const toggleRightCollapsed = (): void => {
    controller.setState((current) => ({
      ...current,
      rightPanel: { ...current.rightPanel, collapsed: !current.rightPanel.collapsed },
    }));
  };

  return (
    <div
      className={`conversation-pane-workspace docking-workspace${multiple ? '' : ' is-single-pane'}${drag ? ' is-dragging' : ''}`}
      data-testid="docking-workspace"
      data-group-count={stageGroupIds.length}
    >
      <div className="docking-workspace-row">
      <div ref={rootRef} className="conversation-pane-stage docking-stage">
        {stageGroupIds.map((groupId) => {
          const group = state.groups[groupId];
          if (!group) return null;
          const rect = usesFullStage
            ? { left: 0, top: 0, width: 1, height: 1 }
            : (groupRectOf(state, groupId, { width: 1, height: 1 }) ?? {
                left: 0,
                top: 0,
                width: 1,
                height: 1,
              });
          return (
            <DockingGroupView
              key={groupId}
              state={state}
              group={group}
              rect={rect}
              spanStage={usesFullStage && groupId === soloGroupId}
              active={state.activeGroupId === groupId}
              hidden={!isGroupVisible(groupId)}
              showChrome={multiple || group.viewIds.length > 1}
              ctx={ctx}
              slotRef={(node) => {
                if (node) slotRefs.current.set(groupId, node);
                else slotRefs.current.delete(groupId);
              }}
              onActivate={() => {
                const viewId = group.activeViewId;
                if (viewId) controller.setState((current) => focusView(current, viewId));
              }}
              onFocusView={(viewId) => controller.setState((current) => focusView(current, viewId))}
              onCloseView={(viewId) => controller.setState((current) => closeView(current, viewId))}
              onToggleMaximize={() => controller.setState((current) => maximizeGroup(current, groupId))}
              maximized={state.displayMode === 'maximized' && state.maximizedGroupId === groupId}
              splitDisabled={stageGroupIds.length >= STAGE_GROUP_HARD_LIMIT}
              onSplit={(edge) => {
                const result = splitGroupAtEdge(state, groupId, edge, controller.createId);
                if (!result.ok) {
                  controller.pushNotice(result.message);
                  return;
                }
                controller.setState(() => result.state);
              }}
              onCreateSession={() => {
                void props.onCreateConversation().then((created) => {
                  if (!created) return;
                  controller.setState((current) => {
                    const opened = openSessionView(current, created, controller.createId, groupId);
                    return opened.ok ? opened.state : current;
                  });
                });
              }}
              onStartDrag={startDrag}
            />
          );
        })}
        {!usesFullStage
          ? listStageSeparatorRects(state, {
              left: 0,
              top: 0,
              width: stagePx.width,
              height: stagePx.height,
            }).map((separator) => (
              <DockingSeparator
                key={separator.splitId}
                separator={separator}
                locale={locale}
                onRatio={(ratio) =>
                  controller.setState((current) => setSplitRatio(current, separator.splitId, ratio))
                }
              />
            ))
          : null}
        {controller.notice ? (
          <div className="conversation-pane-notice" role="status">
            <span>{controller.notice}</span>
            <button type="button" onClick={controller.dismissNotice}>
              {locale === 'zh-CN' ? '关闭' : 'Dismiss'}
            </button>
          </div>
        ) : null}
        {drag?.preview ? <DockingDragOverlay preview={drag.preview} /> : null}
        <div ref={poolRef} hidden className="docking-surface-pool" />
      </div>
      <DockingRightPanel
        state={state}
        ctx={ctx}
        slotRef={(node) => {
          if (!rightGroupId) return;
          if (node) slotRefs.current.set(rightGroupId, node);
          else slotRefs.current.delete(rightGroupId);
        }}
        panelRef={(node) => {
          rightPanelRef.current = node;
        }}
        onFocusView={(viewId) => controller.setState((current) => focusView(current, viewId))}
        onCloseView={(viewId) => controller.setState((current) => closeView(current, viewId))}
        onToggleCollapsed={toggleRightCollapsed}
      />
      {rightGroup && rightGroup.viewIds.length > 0 && state.rightPanel.collapsed ? (
        <DockingRightPanelRail hidden={false} locale={locale} onToggleCollapsed={toggleRightCollapsed} />
      ) : null}
      </div>
      {multiple ? (
        <div className="conversation-pane-presets">
          {TEMPLATES.map((template) => (
            <button
              key={template}
              type="button"
              onClick={() =>
                controller.setState((current) =>
                  applyWorkspaceTemplate(current, template, controller.createId),
                )
              }
            >
              {templateLabel[template]}
            </button>
          ))}
        </div>
      ) : null}
      {viewIds.map((viewId) => {
        const host = hosts.get(viewId);
        const view = state.views[viewId];
        if (!host || !view) return null;
        return createPortal(
          <DockViewContent viewId={viewId} view={view} ctx={ctxRef.current} />,
          host,
          viewId,
        );
      })}
    </div>
  );
}
