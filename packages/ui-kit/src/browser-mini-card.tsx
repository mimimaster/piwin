import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

export const BROWSER_MINI_DRAG_THRESHOLD_PX = 5;
export const BROWSER_MINI_KEYBOARD_NUDGE_PX = 16;

export type BrowserMiniPlacementMode = 'docked' | 'floating';
export type BrowserMiniControlOwner = 'agent' | 'user' | 'idle';
export type BrowserMiniRuntimeState =
  | 'live'
  | 'starting'
  | 'reconnecting'
  | 'stale'
  | 'error';

export type BrowserMiniDragOffset = {
  deltaX: number;
  deltaY: number;
  clientX: number;
  clientY: number;
};

export type BrowserMiniAlertBanner = {
  tone?: 'warning' | 'danger' | 'info' | undefined;
  message: ReactNode;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
};

export type BrowserMiniCardLabels = {
  expand?: string | undefined;
  dismiss?: string | undefined;
  reload?: string | undefined;
  resetPosition?: string | undefined;
  agentOperating?: string | undefined;
  sharedBrowser?: string | undefined;
  staleFrame?: string | undefined;
  reconnecting?: string | undefined;
  starting?: string | undefined;
  emptyPreview?: string | undefined;
  clickToExpandHint?: string | undefined;
  interactHint?: string | undefined;
};

export type BrowserMiniCardProps = {
  /** Page title or formatted host/domain shown in the mini header. */
  title: string;
  /** Optional secondary URL or domain text. */
  urlText?: string | undefined;
  /** Current mirrored frame image URL (data: or blob:/http:). */
  frameSrc?: string | null | undefined;
  /** Alt text for the mirrored frame image. */
  frameAlt?: string | undefined;
  /** Docked below the Session Rail by default, or free-floating after user drag. */
  placementMode?: BrowserMiniPlacementMode | undefined;
  /** Optional floating coordinates (CSS px) when `placementMode === 'floating'`. */
  floatingPosition?: { x: number; y: number } | undefined;
  /** Who currently drives the shared Host browser. */
  controlOwner?: BrowserMiniControlOwner | undefined;
  /** Live stream health — prevents presenting a stale frame as live. */
  runtimeState?: BrowserMiniRuntimeState | undefined;
  /** Optional number of open browser tabs in the shared Host runtime. */
  tabCount?: number | undefined;
  /** Optional actionable banner for JS dialogs (alert/confirm/prompt) or auth blockers. */
  alertBanner?: BrowserMiniAlertBanner | null | undefined;
  /** Custom viewport content when not using `frameSrc`. */
  children?: ReactNode | undefined;
  /** Expand into the full right-panel Browser view (focuses primary `browser` tab). */
  onExpand?: (() => void) | undefined;
  /** Minimize/dismiss the mini card back into the Session Rail indicator. */
  onDismiss?: (() => void) | undefined;
  /** Optional reload micro-action (typically enabled when not mid-agent-gesture). */
  onReload?: (() => void) | undefined;
  /** Snap a floating mini window back to the docked slot below Session Rail. */
  onResetPosition?: (() => void) | undefined;
  /** Pointer drag lifecycle callbacks (triggered once pointer moves past threshold). */
  onDragStart?: ((event: BrowserMiniDragOffset) => void) | undefined;
  onDragMove?: ((event: BrowserMiniDragOffset) => void) | undefined;
  onDragEnd?: ((event: BrowserMiniDragOffset) => void) | undefined;
  /** Keyboard arrow nudge callback for non-drag accessibility. */
  onKeyboardNudge?: ((delta: { dx: number; dy: number }) => void) | undefined;
  /** Restricted page click (clean click on the frame). Header expand stays. */
  onViewportActivate?:
    | ((event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => void)
    | undefined;
  /** Restricted page scroll. The mini never follow-resizes the Host viewport. */
  onViewportWheel?:
    | ((
        event: {
          clientX: number;
          clientY: number;
          deltaX: number;
          deltaY: number;
          currentTarget: HTMLElement;
        },
      ) => void)
    | undefined;
  labels?: BrowserMiniCardLabels | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  testId?: string | undefined;
};

/**
 * Pure threshold check distinguishing a pointer drag from a clean click.
 */
export function isBrowserMiniDragGesture(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  thresholdPx: number = BROWSER_MINI_DRAG_THRESHOLD_PX,
): boolean {
  const dx = currentX - startX;
  const dy = currentY - startY;
  return Math.hypot(dx, dy) >= thresholdPx;
}

function isInteractiveControlTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') {
    return false;
  }
  return Boolean(
    (target as Element).closest(
      'button, a, input, select, textarea, [data-mini-interactive="true"]',
    ),
  );
}

const DEFAULT_LABELS: Required<BrowserMiniCardLabels> = {
  expand: '展开到右侧浏览器面板',
  dismiss: '收起小窗到导轨',
  reload: '刷新当前页面',
  resetPosition: '吸附回右上导轨',
  agentOperating: 'AI 操作中',
  sharedBrowser: '共享',
  staleFrame: '画面已过期',
  reconnecting: '正在重连…',
  starting: '正在启动浏览器…',
  emptyPreview: '暂无实时画面',
  clickToExpandHint: '单击展开完整浏览器 · 按住可拖动位置',
  interactHint: '单击页面 · 滚轮滚动 · 按住拖动小窗',
};

/**
 * Full-bleed live mini preview for the Host-owned shared browser.
 *
 * The card is the viewport: page pixels reach every rounded corner with no
 * header chrome at all. Controls (expand / dismiss / reload / snap-back)
 * surface only on hover or keyboard focus, the domain pill sits at the bottom
 * edge, and a single island dot marks agent control — nothing else competes
 * with the page.
 */
export function BrowserMiniCard(props: BrowserMiniCardProps): ReactElement {
  const {
    title,
    urlText,
    frameSrc,
    frameAlt,
    placementMode = 'docked',
    floatingPosition,
    controlOwner = 'idle',
    runtimeState = 'live',
    tabCount,
    alertBanner,
    children,
    onExpand,
    onDismiss,
    onReload,
    onResetPosition,
    onDragStart,
    onDragMove,
    onDragEnd,
    onKeyboardNudge,
    onViewportActivate,
    onViewportWheel,
    labels: customLabels,
    className,
    style,
    testId = 'browser-mini-card',
  } = props;

  const copy = { ...DEFAULT_LABELS, ...customLabels };
  const [isDragging, setIsDragging] = useState(false);

  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    exceededThreshold: boolean;
  } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || isInteractiveControlTarget(event.target)) {
      return;
    }
    dragSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      exceededThreshold: false,
    };
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* happy-dom or synthetic events without active pointer */
      }
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>): void => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const offset: BrowserMiniDragOffset = {
      deltaX: event.clientX - session.startX,
      deltaY: event.clientY - session.startY,
      clientX: event.clientX,
      clientY: event.clientY,
    };

    if (!session.exceededThreshold) {
      if (
        !isBrowserMiniDragGesture(
          session.startX,
          session.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        return;
      }
      session.exceededThreshold = true;
      setIsDragging(true);
      onDragStart?.(offset);
    }

    onDragMove?.(offset);
  };

  const finishPointerSession = (
    event: PointerEvent<HTMLElement>,
    cancelled: boolean,
  ): void => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragSessionRef.current = null;

    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }

    const offset: BrowserMiniDragOffset = {
      deltaX: event.clientX - session.startX,
      deltaY: event.clientY - session.startY,
      clientX: event.clientX,
      clientY: event.clientY,
    };

    if (session.exceededThreshold) {
      setIsDragging(false);
      onDragEnd?.(offset);
      return;
    }

    if (!cancelled) {
      if (onViewportActivate) {
        onViewportActivate({
          clientX: event.clientX,
          clientY: event.clientY,
          currentTarget: event.currentTarget,
        });
        return;
      }
      onExpand?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (isInteractiveControlTarget(event.target) && event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onExpand?.();
      return;
    }
    if (!onKeyboardNudge) return;
    const step = event.shiftKey
      ? BROWSER_MINI_KEYBOARD_NUDGE_PX * 2
      : BROWSER_MINI_KEYBOARD_NUDGE_PX;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onKeyboardNudge({ dx: 0, dy: -step });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onKeyboardNudge({ dx: 0, dy: step });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onKeyboardNudge({ dx: -step, dy: 0 });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onKeyboardNudge({ dx: step, dy: 0 });
    }
  };

  const rootStyle: CSSProperties = {
    ...style,
    ...(placementMode === 'floating' && floatingPosition
      ? {
          left: `${String(floatingPosition.x)}px`,
          top: `${String(floatingPosition.y)}px`,
        }
      : {}),
  };

  const rootClassName = [
    'piwin-browser-mini-card',
    `piwin-browser-mini-card--${placementMode}`,
    `is-owner-${controlOwner}`,
    `is-state-${runtimeState}`,
    isDragging ? 'is-dragging' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const statusOverlayText =
    runtimeState === 'reconnecting'
      ? copy.reconnecting
      : runtimeState === 'stale' || runtimeState === 'error'
        ? copy.staleFrame
        : runtimeState === 'starting'
          ? copy.starting
          : null;

  const domainText = urlText ?? title;
  const hasControls =
    onExpand !== undefined ||
    onDismiss !== undefined ||
    onReload !== undefined ||
    (placementMode === 'floating' && onResetPosition !== undefined);
  const showDomainPill = hasControls || (tabCount !== undefined && tabCount > 1);

  return (
    <aside
      className={rootClassName}
      style={rootStyle}
      data-testid={testId}
      data-placement={placementMode}
      data-owner={controlOwner}
      data-runtime-state={runtimeState}
      data-dragging={isDragging ? 'true' : 'false'}
      aria-label={`${title} (${copy.sharedBrowser})`}
      role="button"
      tabIndex={0}
      title={onViewportActivate ? copy.interactHint : copy.clickToExpandHint}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishPointerSession(event, false)}
      onPointerCancel={(event) => finishPointerSession(event, true)}
      onKeyDown={handleKeyDown}
      onWheel={
        onViewportWheel
          ? (event) => {
              event.preventDefault();
              onViewportWheel({
                clientX: event.clientX,
                clientY: event.clientY,
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                currentTarget: event.currentTarget,
              });
            }
          : undefined
      }
    >
      {frameSrc ? (
        <img
          src={frameSrc}
          alt={frameAlt ?? title}
          className="piwin-browser-mini-frame"
          data-testid={`${testId}-frame`}
          draggable={false}
        />
      ) : children ? (
        children
      ) : (
        <div
          className="piwin-browser-mini-empty"
          data-testid={`${testId}-empty`}
        >
          {statusOverlayText ?? copy.emptyPreview}
        </div>
      )}

      {/* Agent-control island: a single dot at the top edge — no text header. */}
      {controlOwner === 'agent' ? (
        <span
          className="piwin-browser-mini-island"
          data-testid={`${testId}-agent-island`}
          aria-label={copy.agentOperating}
          title={copy.agentOperating}
        />
      ) : null}

      {/* JS dialog / blocker: an overlay banner, dismissed by expanding. */}
      {alertBanner ? (
        <div
          className={`piwin-browser-mini-alert tone-${alertBanner.tone ?? 'warning'}`}
          data-testid={`${testId}-alert`}
          data-mini-interactive="true"
        >
          <span className="piwin-browser-mini-alert-text">
            {alertBanner.message}
          </span>
          {alertBanner.onAction || onExpand ? (
            <button
              type="button"
              className="piwin-browser-mini-alert-action"
              data-testid={`${testId}-alert-action`}
              onClick={alertBanner.onAction ?? onExpand}
            >
              {alertBanner.actionLabel ?? '去处理'}
            </button>
          ) : null}
        </div>
      ) : null}

      {statusOverlayText && frameSrc ? (
        <div
          className="piwin-browser-mini-state-pill"
          data-testid={`${testId}-state-pill`}
        >
          {statusOverlayText}
        </div>
      ) : null}

      {/* Hover/focus HUD: the only chrome, hidden until requested. */}
      {hasControls || showDomainPill ? (
        <div
          className="piwin-browser-mini-hud"
          data-testid={`${testId}-hud`}
          aria-hidden={isDragging ? 'true' : undefined}
        >
          {hasControls ? (
            <div
              className="piwin-browser-mini-hud-actions"
              data-mini-interactive="true"
            >
              {placementMode === 'floating' && onResetPosition ? (
                <button
                  type="button"
                  className="piwin-browser-mini-hud-btn"
                  data-testid={`${testId}-reset-position`}
                  aria-label={copy.resetPosition}
                  title={copy.resetPosition}
                  onClick={onResetPosition}
                >
                  <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="7" cy="7" r="1.25" fill="currentColor" />
                  </svg>
                </button>
              ) : null}
              {onReload ? (
                <button
                  type="button"
                  className="piwin-browser-mini-hud-btn"
                  data-testid={`${testId}-reload`}
                  aria-label={copy.reload}
                  title={copy.reload}
                  onClick={onReload}
                >
                  <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                    <path
                      d="M11.2 4.8A4.75 4.75 0 1 0 11.6 8.3M11.5 2.4V5h-2.6"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
              {onExpand ? (
                <button
                  type="button"
                  className="piwin-browser-mini-hud-btn"
                  data-testid={`${testId}-expand`}
                  aria-label={copy.expand}
                  title={copy.expand}
                  onClick={onExpand}
                >
                  <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                    <path
                      d="M8.5 2.5H11.5V5.5M5.5 11.5H2.5V8.5M11.5 2.5L7.75 6.25M2.5 11.5L6.25 7.75"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
              {onDismiss ? (
                <button
                  type="button"
                  className="piwin-browser-mini-hud-btn"
                  data-testid={`${testId}-dismiss`}
                  aria-label={copy.dismiss}
                  title={copy.dismiss}
                  onClick={onDismiss}
                >
                  <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                    <path
                      d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          ) : null}

          {showDomainPill ? (
            <span
              className="piwin-browser-mini-domain-pill"
              data-testid={`${testId}-domain-pill`}
            >
              {domainText}
              {tabCount !== undefined && tabCount > 1 ? (
                <span
                  className="piwin-browser-mini-tab-count"
                  data-testid={`${testId}-tab-count`}
                >
                  {tabCount}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
