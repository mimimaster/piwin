/**
 * The collapsed-panel Browser Mini: a live window onto the one Host-shared
 * browser. It never starts its own mirror and never resizes the page.
 * Restricted input (click + wheel) maps onto the existing page; drag still
 * moves the card. Expanding hands the same page to the full Browser panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BrowserMiniCard, type BrowserMiniCardLabels } from '@piwin/ui-kit';
import { useSharedBrowserSession } from './browser-session-provider';
import {
  viewportFromCoverTopDisplay,
  wheelDeltaFromCoverDisplay,
} from './browser-mini-pointer';
import type { BrowserTargetIdentity } from '@piwin/contracts';
import {
  defaultBrowserMiniPosition,
  hasBrowserMiniActivity,
  moveBrowserMini,
  resolveBrowserMiniRuntimeState,
  resolveBrowserMiniTitle,
  shouldSnapBrowserMiniBack,
  type BrowserMiniPoint,
} from './browser-mini-policy';
import { readBrowserMiniPlacement, writeBrowserMiniPlacement } from './browser-mini-placement-store';
import type { DesktopLocale } from '../i18n/desktop-locale';

function miniLabels(locale: DesktopLocale): BrowserMiniCardLabels {
  if (locale === 'zh-CN') {
    return {
      expand: '展开到右侧浏览器面板',
      dismiss: '收起小窗',
      reload: '刷新页面',
      resetPosition: '吸回右上角',
      agentOperating: 'AI 操作中',
      sharedBrowser: '共享浏览器',
      staleFrame: '画面已过期',
      reconnecting: '正在重连…',
      starting: '正在启动浏览器…',
      emptyPreview: '暂无实时画面',
      clickToExpandHint: '单击展开完整浏览器 · 按住可拖动位置',
      interactHint: '单击页面 · 滚轮滚动 · 按住拖动小窗',
    };
  }
  return {
    expand: 'Open in the Browser panel',
    dismiss: 'Hide preview',
    reload: 'Reload page',
    resetPosition: 'Dock top-right',
    agentOperating: 'Agent driving',
    sharedBrowser: 'Shared browser',
    staleFrame: 'Frame is stale',
    reconnecting: 'Reconnecting…',
    starting: 'Starting browser…',
    emptyPreview: 'No live frame yet',
    clickToExpandHint: 'Click to open the full browser · drag to move',
    interactHint: 'Click the page · scroll to pan · drag to move',
  };
}

function dialogBannerText(locale: DesktopLocale, type: string): string {
  if (locale === 'zh-CN') {
    if (type === 'prompt') return '网页在等待输入';
    if (type === 'confirm') return '网页在等待确认';
    return '网页弹出了提示';
  }
  if (type === 'prompt') return 'A page dialog is waiting for input';
  if (type === 'confirm') return 'A page dialog is waiting for confirmation';
  return 'A page dialog is open';
}

function mapMiniPoint(
  event: { clientX: number; clientY: number; currentTarget: HTMLElement },
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  return viewportFromCoverTopDisplay({
    displayX: event.clientX - rect.left,
    displayY: event.clientY - rect.top,
    displayWidth: rect.width,
    displayHeight: rect.height,
    viewportWidth,
    viewportHeight,
  });
}

function miniInputTarget(session: {
  generation: number | undefined;
  pageId: string | undefined;
  documentRevision: number | undefined;
}): BrowserTargetIdentity | undefined {
  if (
    session.generation === undefined ||
    session.pageId === undefined ||
    session.documentRevision === undefined
  ) {
    return undefined;
  }
  return {
    generation: session.generation,
    pageId: session.pageId,
    documentRevision: session.documentRevision,
  };
}

/** The floating window is clamped to the visible viewport. */
function viewportBox(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1280, height: 800 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

export type BrowserMiniWindowProps = {
  locale: DesktopLocale;
  /** The Host socket is live; a dropped socket is never presented as live. */
  hostReady: boolean;
  /** Where the workbench renders it: the rail's docked slot, or free-floating. */
  placement: 'docked' | 'floating';
  onExpand: () => void;
  onDismiss: () => void;
  /** The card left the docked slot; the workbench must host it absolutely. */
  onStartFloating: () => void;
  onSnapBack: () => void;
  onReload: () => void;
  /** Per-Host storage key; a restored corner re-clamps to today's viewport. */
  placementKey: string;
};

export function BrowserMiniWindow(props: BrowserMiniWindowProps): ReactElement | null {
  const session = useSharedBrowserSession();
  const [floatingPoint, setFloatingPoint] = useState<BrowserMiniPoint | null>(null);
  const [container, setContainer] = useState(viewportBox);
  const dragStartRef = useRef<BrowserMiniPoint | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = (): void => setContainer(viewportBox());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Restore the corner the user left the window in, once per Host. The point is
  // re-clamped here, so a smaller window cannot restore it off-screen.
  const restoredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredKeyRef.current === props.placementKey) return;
    restoredKeyRef.current = props.placementKey;
    const stored = readBrowserMiniPlacement(props.placementKey, viewportBox());
    if (stored === null) return;
    setFloatingPoint(stored);
    props.onStartFloating();
  }, [props.placementKey, props.onStartFloating, props]);

  const frameSrc = session?.frame.src ?? '';
  const url = session?.committedUrl ?? '';
  const hasActivity = hasBrowserMiniActivity({
    url,
    owner: session?.owner ?? 'idle',
  });

  // A page that went away (Host teardown, manual stop) drops the floating point
  // so the next appearance starts docked again.
  useEffect(() => {
    if (!hasActivity) setFloatingPoint(null);
  }, [hasActivity]);

  const handleDragStart = useCallback(() => {
    dragStartRef.current =
      floatingPoint ?? defaultBrowserMiniPosition({ container });
    props.onStartFloating();
  }, [container, floatingPoint, props]);

  const handleDragMove = useCallback(
    (offset: { deltaX: number; deltaY: number }) => {
      const start = dragStartRef.current ?? defaultBrowserMiniPosition({ container });
      setFloatingPoint(
        moveBrowserMini({
          point: start,
          delta: { dx: offset.deltaX, dy: offset.deltaY },
          container,
        }),
      );
    },
    [container],
  );

  const handleDragEnd = useCallback(() => {
    dragStartRef.current = null;
    const settled = floatingPoint ?? defaultBrowserMiniPosition({ container });
    if (shouldSnapBrowserMiniBack({ point: settled, container })) {
      setFloatingPoint(null);
      writeBrowserMiniPlacement(props.placementKey, null, container);
      props.onSnapBack();
      return;
    }
    writeBrowserMiniPlacement(props.placementKey, settled, container);
  }, [container, floatingPoint, props]);

  const handleKeyboardNudge = useCallback(
    (delta: { dx: number; dy: number }) => {
      const start = floatingPoint ?? defaultBrowserMiniPosition({ container });
      const next = moveBrowserMini({ point: start, delta, container });
      setFloatingPoint(next);
      writeBrowserMiniPlacement(props.placementKey, next, container);
    },
    [container, floatingPoint, props.placementKey],
  );

  const handleResetPosition = useCallback(() => {
    setFloatingPoint(null);
    writeBrowserMiniPlacement(props.placementKey, null, container);
  }, [container, props.placementKey]);

  const handleViewportActivate = useCallback(
    (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
      if (session === null) return;
      if (session.pendingDialog !== null) {
        props.onExpand();
        return;
      }
      const point = mapMiniPoint(event, session.frame.viewportWidth, session.frame.viewportHeight);
      if (!point) return;
      const target = miniInputTarget(session);
      const events = [
        {
          type: 'mouse' as const,
          action: 'down' as const,
          x: point.x,
          y: point.y,
          button: 'left' as const,
          clickCount: 1,
        },
        {
          type: 'mouse' as const,
          action: 'up' as const,
          x: point.x,
          y: point.y,
          button: 'left' as const,
          clickCount: 1,
        },
      ];
      if (target === undefined) {
        void session.client.browserInput(events);
        return;
      }
      void session.client.browserInput(events, target);
    },
    [props, session],
  );

  const handleViewportWheel = useCallback(
    (event: {
      clientX: number;
      clientY: number;
      deltaX: number;
      deltaY: number;
      currentTarget: HTMLElement;
    }) => {
      if (session === null || session.pendingDialog !== null) return;
      const point = mapMiniPoint(event, session.frame.viewportWidth, session.frame.viewportHeight);
      const delta = wheelDeltaFromCoverDisplay({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        displayWidth: event.currentTarget.getBoundingClientRect().width,
        displayHeight: event.currentTarget.getBoundingClientRect().height,
        viewportWidth: session.frame.viewportWidth,
        viewportHeight: session.frame.viewportHeight,
      });
      if (!point || !delta) return;
      const events = [
        {
          type: 'mouse' as const,
          action: 'wheel' as const,
          x: point.x,
          y: point.y,
          deltaX: delta.deltaX,
          deltaY: delta.deltaY,
        },
      ];
      const target = miniInputTarget(session);
      if (target === undefined) {
        void session.client.browserInput(events);
        return;
      }
      void session.client.browserInput(events, target);
    },
    [session],
  );

  const appendNewTab = useMemo(
    () => (session === null ? 0 : session.tabs.length),
    [session],
  );

  if (session === null || !hasActivity) return null;

  const runtimeState = resolveBrowserMiniRuntimeState({
    lifecycle: session.lifecycle,
    mirror: session.mirror,
    mirrorError: session.mirrorError,
    frameError: session.frameError,
    hostReady: props.hostReady,
    frameSrc,
  });
  const title = resolveBrowserMiniTitle({
    title: session.title,
    url,
    fallback: props.locale === 'zh-CN' ? '浏览器' : 'Browser',
  });
  const pendingDialog = session.pendingDialog;

  return (
    <div className={`stage-browser-mini is-${props.placement}`}>
      <BrowserMiniCard
        testId="browser-mini"
        title={title}
        {...(url.length > 0 ? { urlText: url } : {})}
        {...(frameSrc.length > 0 ? { frameSrc } : {})}
        frameAlt={title}
        placementMode={props.placement}
        {...(floatingPoint === null ? {} : { floatingPosition: floatingPoint })}
        controlOwner={
          session.owner === 'agent' ? 'agent' : session.owner === 'user' ? 'user' : 'idle'
        }
        runtimeState={runtimeState}
        {...(appendNewTab > 1 ? { tabCount: appendNewTab } : {})}
        {...(pendingDialog === null
          ? {}
          : {
              alertBanner: {
                tone: 'warning' as const,
                message: dialogBannerText(props.locale, pendingDialog.type),
              },
            })}
        labels={miniLabels(props.locale)}
        onExpand={props.onExpand}
        onDismiss={props.onDismiss}
        onReload={props.onReload}
        onViewportActivate={handleViewportActivate}
        onViewportWheel={handleViewportWheel}
        {...(floatingPoint === null ? {} : { onResetPosition: handleResetPosition })}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onKeyboardNudge={handleKeyboardNudge}
      />
    </div>
  );
}
