import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
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
import { moveViewToEdge } from './layout-commands.js';
import { listStageGroupIds } from './topology.js';
import {
  isPrimaryDockingLayout,
  primaryLayoutSessionId,
  syncPrimarySessionView,
} from './primary-layout.js';
import { resolveConversationPaneShortcut } from '../../conversation-pane-shortcuts.js';
import type { Point, Rect } from './drag-hit-test.js';
import type { DockDragResolution } from './use-docking-drag.js';
import { useDockingDrag } from './use-docking-drag.js';
import { DockingDragOverlay } from './docking-drag-overlay.js';
import { DockingGroupView } from './docking-group-view.js';
import { DockingSeparator } from './docking-separator.js';
import { resolveDockDrag } from './docking-drop-resolver.js';
import { useSessionDrag, type SessionDragRequest } from './docking-session-drag.js';
import { resolveSidebarDragSource } from './session-drag-source.js';
import { DockViewContent, type DockViewRenderContext } from './docking-surface-content.js';
import { placeSurfaceHosts, useDockingSurfaceHosts } from './surface-pool.js';
import type { DockingWorkspaceController } from './use-docking-workspace.js';
import type { WorkspaceGroup, WorkspaceTemplate } from './types.js';
import { SurfaceTitlebarProvider } from '../../surface-titlebar.js';

export type DockingWorkspaceProps = Omit<DockViewRenderContext, 'onCloseView'> & {
  controller: DockingWorkspaceController;
  phoneSinglePane?: boolean;
  /** The workbench's full chat column, bound to the active session. */
  primaryPane: ReactNode;
  primarySessionId: string | null;
  /** A docking change left a different session as the lone stage view. */
  onPromoteSession?: (sessionId: string) => void;
  keyboardEnabled?: boolean;
  /** Scope key of the active sidebar scope; guarding sidebar drags across projects. */
  activeProjectScopeKey?: string;
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
  // A phone-width stage shows one chat at a time: that is the workbench chat.
  const primaryLayout = phoneSinglePane || isPrimaryDockingLayout(state);
  const primarySessionId = props.primarySessionId;
  const { onPromoteSession } = props;

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
    // Focused is only the phone presentation; widening the window must bring
    // the split back instead of stranding one pane on stage.
    if (!phoneSinglePane && state.displayMode === 'focused') {
      controller.setState((current) => setDisplayMode(current, 'normal'));
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

  // Keep the unsplit stage and the workbench session in step. Sidebar clicks
  // switch the conversation; leftover session tabs on an unsplit stage are
  // folded away. The one exception is collapsing a split (or leftover tabs)
  // back to a lone session view: the conversation left on stage becomes the
  // workbench session.
  const unsplit = state.stage.kind === 'group';
  const unsplitViewCount =
    state.stage.kind === 'group' ? (state.groups[state.stage.groupId]?.viewIds.length ?? 0) : 0;
  const activeUnsplitSessionId = unsplit ? primaryLayoutSessionId(state) : null;
  const layoutSessionId = isPrimaryDockingLayout(state) ? activeUnsplitSessionId : undefined;
  const promoteSessionRef = useRef(onPromoteSession);
  promoteSessionRef.current = onPromoteSession;
  const syncRef = useRef<{ primary: string | null; view: string | null | undefined } | null>(null);
  const { setState: setWorkspaceState, createId: createWorkspaceId } = controller;
  useEffect(() => {
    const previous = syncRef.current;
    const workbenchChanged = previous !== null && previous.primary !== primarySessionId;
    syncRef.current = { primary: primarySessionId, view: layoutSessionId };
    const collapsedToLoneView =
      previous !== null && previous.primary === primarySessionId && previous.view === undefined;
    const promote = promoteSessionRef.current;
    if (
      collapsedToLoneView &&
      layoutSessionId !== null &&
      layoutSessionId !== undefined &&
      layoutSessionId !== primarySessionId &&
      promote
    ) {
      promote(layoutSessionId);
      return;
    }
    if (!unsplit) return;
    if (unsplitViewCount > 1) {
      const keep = workbenchChanged ? primarySessionId : activeUnsplitSessionId;
      setWorkspaceState((current) => syncPrimarySessionView(current, keep, createWorkspaceId));
      return;
    }
    if (layoutSessionId === undefined || layoutSessionId === primarySessionId) return;
    setWorkspaceState((current) => syncPrimarySessionView(current, primarySessionId, createWorkspaceId));
  }, [
    activeUnsplitSessionId,
    createWorkspaceId,
    layoutSessionId,
    primarySessionId,
    setWorkspaceState,
    unsplit,
    unsplitViewCount,
  ]);

  useEffect(() => {
    if (props.keyboardEnabled === false || phoneSinglePane) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const command = resolveConversationPaneShortcut(event);
      if (command?.type !== 'split') return;
      event.preventDefault();
      const current = stateRef.current;
      const result = splitGroupAtEdge(
        current,
        current.activeGroupId,
        command.orientation === 'row' ? 'right' : 'down',
        controller.createId,
      );
      if (!result.ok) {
        controller.pushNotice(result.message);
        return;
      }
      controller.setState(() => result.state);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, phoneSinglePane, props.keyboardEnabled]);

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

  // The right tool group renders inside the workbench right panel, which
  // lends its body slot, drop target, and (for a docked browser) titlebar.
  const rightHost = controller.rightHost;
  const rightGroupId = state.rightPanel.groupIds[0];
  const rightGroup: WorkspaceGroup | undefined = rightGroupId ? state.groups[rightGroupId] : undefined;
  const rightTitlebar = rightHost.titlebar;
  const rightTitlebarViewId =
    rightTitlebar && rightGroup?.activeViewId && state.views[rightGroup.activeViewId]?.kind === 'browser'
      ? rightGroup.activeViewId
      : null;

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
    // The slot stays mounted (hidden) behind the panel's other tabs, so
    // switching tabs never reparents the surface and reloads its frames.
    if (rightHost.slot && right?.activeViewId) {
      placement.set(right.activeViewId, rightHost.slot);
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
        panelElement: rightHost.panel,
        rightPanelVisible: rightHost.open && rightHost.panel !== null,
        createId: controller.createId,
        ...(props.activeProjectScopeKey !== undefined
          ? { activeProjectScopeKey: props.activeProjectScopeKey }
          : {}),
        apply: (next) => {
          controller.setState(() => next);
          controller.requestRightReveal();
        },
      });
    },
    [controller, props.activeProjectScopeKey, pxRects, rightHost, stagePx.height, stagePx.width],
  );

  const { drag, startDrag } = useDockingDrag({
    enabled: true,
    resolve,
    onCommit: (commit) => commit(),
  });

  // Sidebar session rows start their drag outside the stage, so the engine's
  // starter is published to the provider the sidebar reads (spec §3.1).
  const sessionDragBridge = useSessionDrag();
  const registerSessionDrag = sessionDragBridge?.registerStarter;
  useEffect(() => {
    if (!registerSessionDrag) return;
    registerSessionDrag((request: SessionDragRequest) => {
      startDrag(
        request.origin,
        resolveSidebarDragSource(stateRef.current, request.sessionId, request.projectScopeKey),
      );
    });
    return () => registerSessionDrag(null);
  }, [registerSessionDrag, startDrag]);

  const templateLabel: Record<WorkspaceTemplate, string> = {
    single: locale === 'zh-CN' ? '单窗' : 'Single',
    columns: locale === 'zh-CN' ? '左右' : 'Columns',
    rows: locale === 'zh-CN' ? '上下' : 'Rows',
    quad: locale === 'zh-CN' ? '四宫格' : 'Quad',
  };

  return (
    <div
      className={`conversation-pane-workspace docking-workspace${multiple ? '' : ' is-single-pane'}${primaryLayout ? ' is-primary-layout' : ''}${drag ? ' is-dragging' : ''}`}
      data-testid="docking-workspace"
      data-group-count={stageGroupIds.length}
    >
      <div className="docking-workspace-row">
      <div ref={rootRef} className="conversation-pane-stage docking-stage">
        {primaryLayout ? (
          <div className="docking-primary-slot" data-testid="docking-primary-slot">
            {props.primaryPane}
          </div>
        ) : null}
        {primaryLayout ? null : stageGroupIds.map((groupId) => {
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
              active={multiple && state.activeGroupId === groupId}
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
              onMoveViewToEdge={(viewId, edge) => {
                const result = moveViewToEdge(state, viewId, groupId, edge, controller.createId);
                if (!result.ok) {
                  // 'no-op' carries no message: a lone tab on its own edge is legal silence.
                  if (result.message) controller.pushNotice(result.message);
                  return;
                }
                controller.setState(() => result.state);
              }}
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
        // The workbench session is always the full chat column, never a
        // second compact subscriber; the primary layout renders it inline.
        if (view.kind === 'session' && view.sessionId === primarySessionId) {
          return primaryLayout ? null : createPortal(props.primaryPane, host, viewId);
        }
        // Always wrap so entering/leaving the titlebar never remounts the view.
        return createPortal(
          <SurfaceTitlebarProvider value={viewId === rightTitlebarViewId ? rightTitlebar : null}>
            <DockViewContent
              viewId={viewId}
              view={view}
              ctx={ctxRef.current}
            />
          </SurfaceTitlebarProvider>,
          host,
          viewId,
        );
      })}
    </div>
  );
}
