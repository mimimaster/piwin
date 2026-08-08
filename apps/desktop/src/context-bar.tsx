/**
 * ContextBar — stage-local chrome (no full-window topbar).
 *
 * Lives only in the middle column. Left: sidebar + history + title.
 * Right: theme / more / work-panel. Middle flex is the drag region.
 *
 * Data-testids:
 *   - "workspace-context-header"
 *   - "run-status-strip" / "run-status-stop" / "run-status-stopping"
 *   - "rail-chats-btn" / "right-panel-open-btn" / titlebar-*
 */
import type { ReactElement } from 'react';
import { Button, IconButton } from '@piwin/ui-kit';
import type { PermissionPreset } from '@piwin/contracts';
import type { ProductSessionOrigin } from '@piwin/contracts';
import type { RunStatusView } from './run-status.js';
import { RunActivityInline } from './RunActivityInline.js';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import {
  IconChevronLeft,
  IconChevronRight,
  IconForkConversation,
  IconMoon,
  IconPanelLeft,
  IconPanelRight,
  IconSun,
} from './shell-icons';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from './native-window-drag';

export type ContextBarSession = {
  title: string;
  scopeLabel: string;
};

export type ContextBarProps = {
  session: ContextBarSession;
  /** SF-04: product session origin for branch/duplicate badge. */
  origin?: ProductSessionOrigin | null;
  /** SF-04: callback to return to root/parent session. */
  onReturnToRoot?: (() => void) | undefined;
  runState: RunStatusView;
  onStop: () => void;
  onViewActivity: () => void;
  onReviewPermission: () => void;
  onViewPlan: () => void;
  onCancelCompact: () => void;
  onRetry?: (() => void) | undefined;
  /** ADR 0024 — Run Mode badge; click opens Settings → Permissions. */
  permissionMode?: PermissionPreset | null;
  onOpenPermissions?: (() => void) | undefined;
  locale?: DesktopLocale;
  /** Shell chrome previously on WorkspaceTitlebar. */
  appearanceMode?: 'light' | 'dark';
  sessionsExpanded?: boolean;
  onToggleSessions?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onOpenSkills?: () => void;
  onOpenMcp?: () => void;
  onToggleAppearance?: () => void;
  onOpenSettings?: () => void;
  workPanelOpen?: boolean;
  onToggleWorkPanel?: () => void;
  /** Whether the current session is a conversation (general) session. */
  isConversationSession?: boolean;
};

function modeBadgeLabel(preset: PermissionPreset): string {
  switch (preset) {
    case 'auto':
      return 'Auto';
    case 'ask':
      return 'Ask';
    case 'yolo':
      return 'YOLO';
  }
}

function formatElapsed(elapsedMs: number): string {
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${minutes}m ${elapsedSeconds % 60}s`;
}

function phaseDotClass(kind: RunStatusView['kind']): string {
  switch (kind) {
    case 'preparing':
    case 'connecting-model':
    case 'waiting-first-token':
    case 'working':
    case 'planning':
    case 'compacting':
    case 'stopping':
      return 'context-bar-phase-dot is-running';
    case 'waiting-permission':
      return 'context-bar-phase-dot is-warning';
    case 'failed':
      return 'context-bar-phase-dot is-error';
    case 'complete':
      return 'context-bar-phase-dot is-complete';
    case 'stopped':
    case 'idle':
    default:
      return 'context-bar-phase-dot';
  }
}

export function ContextBar(props: ContextBarProps): ReactElement {
  const { session, runState } = props;
  const elapsedText = runState.elapsedMs !== undefined ? formatElapsed(runState.elapsedMs) : null;
  const locale = props.locale ?? 'zh-CN';
  const isChinese = locale === 'zh-CN';
  const copy = getDesktopCopy(locale);
  const titlebarCopy = copy.titlebar;
  const mode = props.permissionMode ?? null;
  const canGoBack = props.canGoBack === true;
  const canGoForward = props.canGoForward === true;
  const workPanelOpen = props.workPanelOpen === true;
  const workPanelLabel = workPanelOpen
    ? titlebarCopy.collapseWorkspacePanel
    : titlebarCopy.expandWorkspacePanel;
  const themeToggleLabel =
    props.appearanceMode === 'light'
      ? titlebarCopy.switchToDarkTheme
      : titlebarCopy.switchToLightTheme;

  return (
    <header
      className="context-bar context-titlebar-box"
      data-testid="workspace-context-header"
      data-kind={runState.kind}
      data-tauri-drag-region
      onMouseDown={handleNativeWindowDragMouseDown}
    >
      <div className="context-bar-leading" data-no-window-drag role="group" aria-label={titlebarCopy.shellNavigation}>
        {props.onToggleSessions && !props.sessionsExpanded ? (
          <IconButton
            className="context-bar-sessions-toggle"
            data-testid="rail-chats-btn"
            label={titlebarCopy.expandSidebar}
            aria-expanded={false}
            onClick={props.onToggleSessions}
          >
            <IconPanelLeft />
          </IconButton>
        ) : null}

        {!props.sessionsExpanded ? (
          <div className="context-bar-history">
            <IconButton
              className="context-bar-history-btn"
              data-testid="titlebar-back-btn"
              label={titlebarCopy.back}
              disabled={!canGoBack}
              aria-disabled={!canGoBack}
              onClick={() => {
                if (canGoBack) {
                  props.onGoBack?.();
                }
              }}
            >
              <IconChevronLeft />
            </IconButton>
            <IconButton
              className="context-bar-history-btn"
              data-testid="titlebar-forward-btn"
              label={titlebarCopy.forward}
              disabled={!canGoForward}
              aria-disabled={!canGoForward}
              onClick={() => {
                if (canGoForward) {
                  props.onGoForward?.();
                }
              }}
            >
              <IconChevronRight />
            </IconButton>
          </div>
        ) : null}
      </div>

      <div className="context-bar-identity">
        <span className="context-bar-title" title={session.title}>
          {session.title}
        </span>
        <span className="context-bar-scope-pill">{session.scopeLabel}</span>
        {mode ? (
          <button
            type="button"
            className={
              mode === 'yolo' ? 'context-bar-mode-badge is-warning' : 'context-bar-mode-badge'
            }
            data-testid="context-bar-mode-badge"
            data-mode={mode}
            title={
              isChinese
                ? '运行模式 — 点击打开权限设置'
                : 'Run mode — click to open Permissions settings'
            }
            onClick={props.onOpenPermissions}
          >
            {modeBadgeLabel(mode)}
          </button>
        ) : null}
        {props.origin ? (
          <button
            type="button"
            className="context-bar-origin-badge"
            data-testid="context-bar-origin-badge"
            data-origin-kind={props.origin.kind}
            title={
              props.origin.kind === 'fork'
                ? isChinese
                  ? `从「${props.origin.sourceSessionNameSnapshot ?? '源会话'}」分叉`
                  : `Forked from "${props.origin.sourceSessionNameSnapshot ?? 'source session'}"`
                : isChinese
                  ? `复制自「${props.origin.sourceSessionNameSnapshot ?? '源会话'}」`
                  : `Duplicated from "${props.origin.sourceSessionNameSnapshot ?? 'source session'}"`
            }
            onClick={props.onReturnToRoot}
          >
            <IconForkConversation width={12} height={12} />
            <span>
              {props.origin.kind === 'fork'
                ? isChinese
                  ? '分支'
                  : 'Branch'
                : isChinese
                  ? '副本'
                  : 'Duplicate'}
            </span>
          </button>
        ) : null}
      </div>

      <div
        className="context-bar-status" data-no-window-drag
        data-testid="run-status-strip"
        data-kind={runState.kind}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={runState.kind !== 'idle' ? runState.label : undefined}
      >
        <i className={phaseDotClass(runState.kind)} aria-hidden />
        {runState.kind !== 'idle' ? (
          <RunActivityInline
            runState={runState}
            {...(props.locale ? { locale: props.locale } : {})}
          />
        ) : null}
        {elapsedText !== null ? (
          <span className="context-bar-elapsed muted" aria-hidden>
            {elapsedText}
          </span>
        ) : null}

        {runState.primaryAction === 'view-activity' ? (
          <Button size="compact" onClick={props.onViewActivity}>
            Activity
          </Button>
        ) : null}
        {runState.primaryAction === 'review-permission' ? (
          <Button size="compact" variant="primary" onClick={props.onReviewPermission}>
            Review request
          </Button>
        ) : null}
        {runState.primaryAction === 'view-plan' ? (
          <Button size="compact" onClick={props.onViewPlan}>
            View plan
          </Button>
        ) : null}
        {runState.kind === 'compacting' ? (
          <Button size="compact" onClick={props.onCancelCompact}>
            Cancel
          </Button>
        ) : null}
        {runState.canStop ? (
          <Button size="compact" data-testid="run-status-stop" onClick={props.onStop}>
            Stop
          </Button>
        ) : null}
        {runState.kind === 'stopping' ? (
          <span className="muted" data-testid="run-status-stopping">
            Stopping…
          </span>
        ) : null}
        {runState.primaryAction === 'retry' && props.onRetry !== undefined ? (
          <Button size="compact" onClick={props.onRetry}>
            Retry
          </Button>
        ) : null}
      </div>

      <WindowDragRegion
        className="context-bar-drag"
        data-testid="context-bar-drag"
        aria-label={titlebarCopy.dragWindow}
      />

      {!workPanelOpen ? (
        <div className="context-bar-controls" data-no-window-drag role="toolbar" aria-label={titlebarCopy.tools}>
        {props.onToggleAppearance ? (
          <IconButton
            className="context-bar-theme-toggle"
            data-testid="titlebar-theme-toggle"
            label={themeToggleLabel}
            title={themeToggleLabel}
            aria-pressed={props.appearanceMode === 'dark'}
            onClick={() => props.onToggleAppearance?.()}
          >
            {props.appearanceMode === 'light' ? <IconMoon /> : <IconSun />}
          </IconButton>
        ) : null}

        {props.onToggleWorkPanel && !props.isConversationSession ? (
          <IconButton
            className={
              workPanelOpen ? 'context-bar-inspector-btn active' : 'context-bar-inspector-btn'
            }
            data-testid="right-panel-open-btn"
            label={workPanelLabel}
            title={workPanelLabel}
            aria-pressed={workPanelOpen}
            aria-expanded={workPanelOpen}
            onClick={() => props.onToggleWorkPanel?.()}
          >
            <IconPanelRight />
          </IconButton>
        ) : null}
        </div>
      ) : null}
    </header>
  );
}
