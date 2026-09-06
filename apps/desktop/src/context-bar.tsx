/**
 * ContextBar — the window titleband. Under the Inkstone themes the `tb` class
 * places it over the stage column only (proto-00-shell.html 00.2: the nav and
 * inspector own their own 42px header strips); Deck themes keep the full-width
 * overlay band via region-shell.css.
 *
 * Left: history + status signal + serif title. Right: run status and tools.
 * Middle flex is the drag region. The window controls are permanent — they do
 * not migrate between here and the sidebar as the sidebar opens and closes.
 *
 * Data-testids:
 *   - "workspace-context-header"
 *   - "run-status-strip" / "run-status-stop" / "run-status-stopping"
 *   - "rail-chats-btn" / "right-panel-open-btn" / titlebar-*
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Button, IconButton, IconGit } from '@piwin/ui-kit';
import type { PermissionPreset } from '@piwin/contracts';
import type { ProductSessionOrigin } from '@piwin/contracts';
import type { RunStatusView } from './run-status.js';
import { RunActivityInline } from './RunActivityInline.js';
import {
  conversationActivityLabel,
  resolveConversationActivityKind,
} from './conversation-activity.js';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import {
  IconChevronLeft,
  IconChevronRight,
  IconPanelLeft,
  IconPanelRight,
} from './shell-icons';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from './native-window-drag';

export type ContextBarSession = {
  title: string;
  scopeLabel: string;
};

export type ContextBarProps = {
  session: ContextBarSession;
  /** Opens the session search palette (⇧⌘F) from the titleband right cluster. */
  onOpenSearch?: (() => void) | undefined;
  /** Persistent session-level navigation control rendered beside the title. */
  sessionTreeControl?: ReactNode;
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
  /** When true, do not render title or identity in the top band (title lives in stage card header). */
  hideIdentity?: boolean | undefined;
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

/** Proto-00 shell state vocabulary: the titleband carries lamp (running) and
 *  zhu square (waiting) signals keyed off this three-value mapping. */
function shellStateKind(kind: RunStatusView['kind']): 'idle' | 'running' | 'waiting' {
  switch (kind) {
    case 'waiting-permission':
      return 'waiting';
    case 'preparing':
    case 'connecting-model':
    case 'waiting-first-token':
    case 'working':
    case 'planning':
    case 'compacting':
    case 'stopping':
      return 'running';
    default:
      return 'idle';
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
  const shellState = shellStateKind(runState.kind);
  const canGoBack = props.canGoBack === true;
  const canGoForward = props.canGoForward === true;
  const workPanelOpen = props.workPanelOpen === true;
  const workPanelLabel = workPanelOpen
    ? titlebarCopy.collapseWorkspacePanel
    : titlebarCopy.expandWorkspacePanel;

  const isNativeTraffic =
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    (navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Mac'));

  const [slab, setSlab] = useState<'ink' | 'paper'>(() => {
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('data-slab') as 'ink' | 'paper') || 'ink';
    }
    return 'ink';
  });

  const handleSetSlab = (nextSlab: 'ink' | 'paper') => {
    setSlab(nextSlab);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-slab', nextSlab);
      const app = document.getElementById('app');
      if (app) {
        app.setAttribute('data-slab', nextSlab);
      }
    }
  };

  return (
    <header
      className="context-bar context-titlebar-box proto"
      data-testid="workspace-context-header"
      data-kind={runState.kind}
      data-state={shellState}
      data-tauri-drag-region
      onMouseDown={handleNativeWindowDragMouseDown}
    >
      <div
        className="context-bar-leading proto-nav"
        data-no-window-drag
        role="group"
        aria-label={titlebarCopy.shellNavigation}
      >
        <div
          className={`traffic${isNativeTraffic ? ' is-native' : ''}`}
          aria-label={isChinese ? '窗口控制' : 'Window controls'}
        >
          <span className="traffic-dot close" />
          <span className="traffic-dot minimize" />
          <span className="traffic-dot maximize" />
        </div>

        {props.onToggleSessions ? (
          <IconButton
            className="context-bar-sessions-toggle ib"
            data-testid="rail-chats-btn"
            label={
              props.sessionsExpanded ? titlebarCopy.collapseSidebar : titlebarCopy.expandSidebar
            }
            aria-expanded={props.sessionsExpanded === true}
            onClick={props.onToggleSessions}
          >
            <IconPanelLeft width={14} height={14} stroke={1.6} />
          </IconButton>
        ) : null}

        <span className="proto-nav-spacer" />

        <div className="context-bar-history">
          <IconButton
            className="context-bar-history-btn ib"
            data-testid="titlebar-back-btn"
            label={titlebarCopy.back}
            disabled={!canGoBack}
            onClick={() => {
              props.onGoBack?.();
            }}
          >
            <IconChevronLeft width={14} height={14} stroke={1.6} />
          </IconButton>
          <IconButton
            className="context-bar-history-btn ib"
            data-testid="titlebar-forward-btn"
            label={titlebarCopy.forward}
            disabled={!canGoForward}
            onClick={() => {
              props.onGoForward?.();
            }}
          >
            <IconChevronRight width={14} height={14} stroke={1.6} />
          </IconButton>
        </div>
      </div>

      {!props.hideIdentity ? (
        <>
          <div className="context-bar-identity title">
        {shellState === 'running' ? <span className="lamp" aria-hidden /> : null}
        {shellState === 'waiting' ? <span className="sq" aria-hidden /> : null}
        <span className="context-bar-title tt" title={session.title}>
          {session.title}
        </span>
        {props.sessionTreeControl ? (
          <span className="context-bar-session-tree-slot" data-no-window-drag>
            {props.sessionTreeControl}
          </span>
        ) : null}
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
            <IconGit width={12} height={12} stroke={1.8} />
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
        className="context-bar-status status"
        data-no-window-drag
        data-testid="run-status-strip"
        data-kind={runState.kind}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={runState.kind !== 'idle' ? runState.label : undefined}
      >
        {runState.kind !== 'idle' ? (
          <i className={phaseDotClass(runState.kind)} aria-hidden />
        ) : null}
        {runState.kind !== 'idle' ? (
          props.isConversationSession ? (
            <span className="run-activity-inline" data-testid="conversation-activity">
              {conversationActivityLabel(
                resolveConversationActivityKind({
                  runState,
                  streaming: runState.kind !== 'complete' && runState.kind !== 'stopped' && runState.kind !== 'failed',
                  ...(runState.activeToolName
                    ? {
                        tools: [
                          {
                            toolCallId: 'context-bar-active',
                            toolName: runState.activeToolName,
                            status: 'running',
                            output: '',
                          },
                        ],
                      }
                    : {}),
                }) ?? 'thinking',
                locale === 'en' ? 'en' : 'zh-CN',
              )}
            </span>
          ) : (
            <RunActivityInline
              runState={runState}
              {...(props.locale ? { locale: props.locale } : {})}
            />
          )
        ) : null}
        {elapsedText !== null ? (
          <span className="context-bar-elapsed muted" aria-hidden>
            {elapsedText}
          </span>
        ) : null}

        {runState.primaryAction === 'view-activity' && !props.isConversationSession ? (
          <Button size="compact" onClick={props.onViewActivity}>
            Activity
          </Button>
        ) : null}
        {runState.primaryAction === 'review-permission' && !props.isConversationSession ? (
          <Button size="compact" variant="primary" onClick={props.onReviewPermission}>
            Review request
          </Button>
        ) : null}
        {runState.primaryAction === 'view-plan' && !props.isConversationSession ? (
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
      </>
      ) : null}

      <WindowDragRegion
        className="context-bar-drag"
        data-testid="context-bar-drag"
        aria-label={titlebarCopy.dragWindow}
      />

      <div
        className="context-bar-controls context-bar-right-cluster"
        data-no-window-drag
        role="toolbar"
        aria-label={titlebarCopy.tools}
      >
        <span className="seg ml" aria-label={isChinese ? '输入石板' : 'Input slab'}>
          <button
            type="button"
            className={slab === 'ink' ? 'on' : ''}
            title={isChinese ? '输入石板 · 砚' : 'Input slab: Ink'}
            onClick={() => handleSetSlab('ink')}
          >
            {isChinese ? '砚' : 'Ink'}
          </button>
          <button
            type="button"
            className={slab === 'paper' ? 'on' : ''}
            title={isChinese ? '输入石板 · 纸' : 'Input slab: Paper'}
            onClick={() => handleSetSlab('paper')}
          >
            {isChinese ? '纸' : 'Paper'}
          </button>
        </span>

        {props.onToggleAppearance ? (
          <span
            className="seg"
            aria-label={isChinese ? '外观' : 'Appearance'}
            data-testid="titlebar-theme-toggle-group"
          >
            <button
              type="button"
              className={props.appearanceMode === 'light' ? 'on' : ''}
              data-testid={
                props.appearanceMode === 'dark' ? 'titlebar-theme-toggle' : 'titlebar-theme-light'
              }
              title={titlebarCopy.switchToLightTheme}
              onClick={() => {
                if (props.appearanceMode === 'dark') props.onToggleAppearance?.();
              }}
            >
              {isChinese ? '纸' : 'Light'}
            </button>
            <button
              type="button"
              className={props.appearanceMode === 'dark' ? 'on' : ''}
              data-testid={
                props.appearanceMode === 'light' ? 'titlebar-theme-toggle' : 'titlebar-theme-dark'
              }
              title={titlebarCopy.switchToDarkTheme}
              onClick={() => {
                if (props.appearanceMode === 'light') props.onToggleAppearance?.();
              }}
            >
              {isChinese ? '墨' : 'Dark'}
            </button>
          </span>
        ) : null}

        {props.onToggleWorkPanel ? (
          <IconButton
            className={
              workPanelOpen
                ? 'context-bar-inspector-btn active ib'
                : 'context-bar-inspector-btn ib'
            }
            data-testid="right-panel-open-btn"
            data-action="inspector"
            label={workPanelLabel}
            title={workPanelLabel}
            aria-pressed={workPanelOpen}
            aria-expanded={workPanelOpen}
            onClick={() => props.onToggleWorkPanel?.()}
          >
            <IconPanelRight width={14} height={14} stroke={1.6} />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
