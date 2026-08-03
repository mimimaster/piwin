/**
 * Shell titleband: sidebar toggle, app navigation back/forward, compact overflow tools.
 * Brand and host status live in the left navigator.
 */
import type { ReactElement } from 'react';
import {
  IconChevronLeft,
  IconChevronRight,
  IconMcp,
  IconMoon,
  IconMore,
  IconPanelLeft,
  IconPanelRight,
  IconSkill,
  IconSun,
} from './shell-icons';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import { DropdownMenu, DropdownMenuItem, IconButton } from '@piwin/ui-kit';

export type WorkspaceTitlebarProps = {
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
  /** Right work panel expanded (quiet workbench: titleband toggle). */
  workPanelOpen?: boolean;
  onToggleWorkPanel?: () => void;
  locale?: DesktopLocale;
  /** Active session display name — pure label, no titlebar actions. */
  sessionName?: string;
};

function startNativeWindowDrag(): void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return;
  }

  // The data attribute covers normal Tauri titlebars. Overlay windows on macOS
  // can ignore it, so explicitly begin the native drag as a reliable fallback.
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
    .catch((error: unknown) => {
      console.warn('[piwin] native window drag failed', error);
    });
}

export function WorkspaceTitlebar(props: WorkspaceTitlebarProps): ReactElement {
  const copy = getDesktopCopy(props.locale ?? 'zh-CN');
  const isEnglish = props.locale === 'en';
  const canGoBack = props.canGoBack === true;
  const canGoForward = props.canGoForward === true;
  const workPanelOpen = props.workPanelOpen === true;
  const workPanelLabel = workPanelOpen
    ? isEnglish
      ? 'Collapse workspace panel'
      : '收起右侧工作面板'
    : isEnglish
      ? 'Expand workspace panel'
      : '展开右侧工作面板';
  const themeToggleLabel =
    props.appearanceMode === 'light'
      ? isEnglish
        ? 'Switch to dark theme'
        : '切换到深色主题'
      : isEnglish
        ? 'Switch to light theme'
        : '切换到浅色主题';

  const sessionName = props.sessionName?.trim() ?? '';
  const showTitle = sessionName.length > 0;
  // Full name on hover when the visible title is truncated with ellipsis.
  const tooltip = sessionName;

  return (
    <header className="titlebar workbench-topbar" data-testid="workbench-topbar">
      <IconButton
        className={
          props.sessionsExpanded ? 'topbar-sessions-toggle active' : 'topbar-sessions-toggle'
        }
        data-testid="rail-chats-btn"
        label={props.sessionsExpanded ? '收起左边栏' : '展开左边栏'}
        aria-expanded={props.sessionsExpanded}
        onClick={props.onToggleSessions}
      >
        <IconPanelLeft />
      </IconButton>

      <div className="titlebar-history" role="group" aria-label="Shell navigation">
        <IconButton
          className="titlebar-history-btn"
          data-testid="titlebar-back-btn"
          label="上一步"
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
          className="titlebar-history-btn"
          data-testid="titlebar-forward-btn"
          label="下一步"
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

      {/* Display-only session title (no breadcrumb / badges / click actions). */}
      {showTitle ? (
        <div
          className="titlebar-session-title"
          data-testid="titlebar-session-title"
          title={tooltip}
        >
          <span className="titlebar-session-title-text">{sessionName}</span>
        </div>
      ) : null}

      <div
        className="titlebar-spacer"
        data-tauri-drag-region
        aria-label="Drag window"
        onMouseDown={(event) => {
          if (event.button === 0) {
            startNativeWindowDrag();
          }
        }}
      />

      <div className="titlebar-actions" role="toolbar" aria-label="Tools">
        {props.onToggleAppearance ? (
          <IconButton
            className="titlebar-theme-toggle"
            data-testid="titlebar-theme-toggle"
            label={themeToggleLabel}
            title={themeToggleLabel}
            aria-pressed={props.appearanceMode === 'dark'}
            onClick={() => props.onToggleAppearance?.()}
          >
            {props.appearanceMode === 'light' ? <IconMoon /> : <IconSun />}
          </IconButton>
        ) : null}

        <div className="more-menu-wrap">
          <DropdownMenu
            label="More tools"
            trigger={
              <IconButton title="More" label="More tools" data-testid="titlebar-more-menu">
                <IconMore />
              </IconButton>
            }
          >
            <DropdownMenuItem testId="more-sessions" onSelect={() => props.onToggleSessions?.()}>
              <IconPanelLeft /> Sessions
            </DropdownMenuItem>
            <DropdownMenuItem testId="more-skills" onSelect={() => props.onOpenSkills?.()}>
              <IconSkill width={16} height={16} /> Skills
            </DropdownMenuItem>
            <DropdownMenuItem testId="more-mcp" onSelect={() => props.onOpenMcp?.()}>
              <IconMcp width={16} height={16} /> MCP
            </DropdownMenuItem>
            {props.onOpenSettings ? (
              <DropdownMenuItem testId="more-settings" onSelect={() => props.onOpenSettings?.()}>
                {copy.settings}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenu>
        </div>

        {props.onToggleWorkPanel ? (
          <IconButton
            className={workPanelOpen ? 'titlebar-panel-toggle active' : 'titlebar-panel-toggle'}
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
    </header>
  );
}
