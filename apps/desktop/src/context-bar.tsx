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
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { IconButton, IconGit } from '@piwin/ui-kit';
import type { PermissionPreset } from '@piwin/contracts';
import type { ProductSessionOrigin } from '@piwin/contracts';
import type { RunStatusView } from './run-status.js';
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
  /** Optional trailing chips (e.g. project & git branch). */
  trailing?: ReactNode | undefined;
};

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
  const locale = props.locale ?? 'zh-CN';
  const isChinese = locale === 'zh-CN';
  const copy = getDesktopCopy(locale);
  const titlebarCopy = copy.titlebar;
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
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage?.getItem('piwin:slab-material');
        if (stored === 'ink' || stored === 'paper') return stored;
      } catch {
        // ignore
      }
    }
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('data-slab') as 'ink' | 'paper') || 'ink';
    }
    return 'ink';
  });

  const handleSetSlab = (nextSlab: 'ink' | 'paper') => {
    setSlab(nextSlab);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem('piwin:slab-material', nextSlab);
      } catch {
        // ignore
      }
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-slab', nextSlab);
      const app = document.getElementById('app');
      if (app) {
        app.setAttribute('data-slab', nextSlab);
      }
    }
  };

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-slab', slab);
      const app = document.getElementById('app');
      if (app) {
        app.setAttribute('data-slab', slab);
      }
    }
  }, [slab]);


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
            <IconPanelLeft width={16} height={16} stroke={1.4} />
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
          {props.trailing}
        </div>
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
            aria-label={isChinese ? '输入石板 · 砚' : 'Input slab: Ink'}
            aria-pressed={slab === 'ink'}
            onClick={() => handleSetSlab('ink')}
          >
            {isChinese ? '砚' : 'Ink'}
          </button>
          <button
            type="button"
            className={slab === 'paper' ? 'on' : ''}
            title={isChinese ? '输入石板 · 纸' : 'Input slab: Paper'}
            aria-label={isChinese ? '输入石板 · 纸' : 'Input slab: Paper'}
            aria-pressed={slab === 'paper'}
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
              aria-label={titlebarCopy.switchToLightTheme}
              aria-pressed={props.appearanceMode === 'light'}
              data-testid={
                props.appearanceMode === 'dark' ? 'titlebar-theme-toggle' : 'titlebar-theme-light'
              }
              title={titlebarCopy.switchToLightTheme}
              onClick={() => {
                if (props.appearanceMode === 'dark') props.onToggleAppearance?.();
              }}
            >
              {isChinese ? '明' : 'Light'}
            </button>
            <button
              type="button"
              className={props.appearanceMode === 'dark' ? 'on' : ''}
              aria-label={titlebarCopy.switchToDarkTheme}
              aria-pressed={props.appearanceMode === 'dark'}
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
            <IconPanelRight width={16} height={16} stroke={1.4} />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
