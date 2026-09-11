/**
 * Stage ContextBar of the desktop workbench (extracted from App.tsx).
 * Host commands stay with App; this file owns title/scope labels, lineage
 * popover, and run-status chrome callbacks.
 */
import type { ReactElement, ReactNode } from 'react';
import type {
  PermissionPreset,
  ProductSessionOrigin,
  ProjectRecord,
  TranscriptBranchPoint,
} from '@piwin/contracts';
import { ContextBar } from './context-bar';
import type { ChatUiState } from './chat-reducer';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import { projectLabel } from './project-display-name';
import type { RightPanelTab } from './right-panel';
import type { RunStatusView } from './run-status';
import { ConversationTreeHeaderPopover } from './conversation-tree-popover';
import type { ShellSettingsSection } from './shell-navigation';
import {
  resolveWorkbenchScopeLabel,
  resolveWorkbenchSessionTitle,
} from './workbench-chrome-assembly';
import { isConversationSessionChrome } from './is-conversation-session';
import type { SidebarMode } from './sidebar-mode';

type ContextBarShell = {
  toggleSessions: () => void;
  toggleInspector: (tab?: RightPanelTab | null) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  activeSubPage?: string | null | undefined;
};

export type WorkbenchContextBarProps = {
  state: ChatUiState;
  sidebarMode: SidebarMode;
  recentProjects: readonly ProjectRecord[];
  activeSessionName: string;
  activeSessionOrigin: ProductSessionOrigin | null;
  branchPoints: readonly TranscriptBranchPoint[];
  streaming?: boolean;
  onSwitchBranch: (headMessageId: string) => void;
  runStatus: RunStatusView;
  lastUserMessage: { id: string; text: string } | null;
  effectiveRunMode: PermissionPreset;
  locale: DesktopLocale;
  appearanceMode: 'light' | 'dark';
  sessionsExpanded: boolean;
  workPanelOpen: boolean;
  rightPanelTab: RightPanelTab | null;
  shell: ContextBarShell;
  onStop: () => void | Promise<void>;
  onCancelCompact: () => void | Promise<void>;
  onOpenInspector: (tab: RightPanelTab) => void;
  openSettingsSection: (section: ShellSettingsSection) => void;
  onToggleAppearance: () => void;
  onResumeSession: (sessionId: string) => void | Promise<void>;
  onRetryLastUser: (messageId: string) => void | Promise<void>;
  onOpenSessionSearch?: () => void;
  isInkstone?: boolean;
  trailing?: ReactNode | undefined;
};

export function WorkbenchContextBar(props: WorkbenchContextBarProps): ReactElement {
  const {
    state,
    sidebarMode,
    recentProjects,
    activeSessionName,
    activeSessionOrigin,
    branchPoints,
    streaming,
    onSwitchBranch,
    runStatus,
    lastUserMessage,
    effectiveRunMode,
    locale,
    appearanceMode,
    sessionsExpanded,
    workPanelOpen,
    rightPanelTab,
    shell,
    onStop,
    onCancelCompact,
    onOpenInspector,
    openSettingsSection,
    onToggleAppearance,
    onResumeSession,
    onRetryLastUser,
  } = props;
  const desktopCopy = getDesktopCopy(locale);
  const activeSessionId = state.activeSessionId;

  const subPageTitle =
    shell.activeSubPage === 'library' ||
    shell.activeSubPage === 'images' ||
    shell.activeSubPage === 'videos'
      ? locale === 'zh-CN'
        ? '资料库'
        : 'Library'
      : shell.activeSubPage === 'flashcards'
        ? locale === 'zh-CN'
          ? '闪卡'
          : 'Flashcards'
        : null;

  return (
    <ContextBar
      session={{
        title:
          subPageTitle ??
          resolveWorkbenchSessionTitle({
            projectPath: state.projectPath,
            projectLabel: state.projectPath
              ? projectLabel(state.projectPath, recentProjects)
              : null,
            sessionName: activeSessionName,
          }),
        scopeLabel: resolveWorkbenchScopeLabel({
          isGeneral: state.activeScope.kind === 'general',
          locale,
          generalCopy: desktopCopy.general,
        }),
      }}
      {...(activeSessionId && !subPageTitle
        ? {
            sessionTreeControl: (
              <ConversationTreeHeaderPopover
                branchPoints={branchPoints}
                disabled={streaming === true}
                onSwitch={onSwitchBranch}
                locale={locale}
                isConversationSession={
                  !subPageTitle && isConversationSessionChrome(state.activeScope, sidebarMode)
                }
              />
            ),
          }
        : {})}
      isConversationSession={
        !subPageTitle && isConversationSessionChrome(state.activeScope, sidebarMode)
      }
      runState={runStatus}
      onStop={() => void onStop()}
      onViewActivity={() => onOpenInspector('terminal')}
      onReviewPermission={() => {
        // Focus the inline permission card in the stream when present.
        const gate = document.querySelector<HTMLElement>('[data-testid="permission-bar"]');
        gate?.focus?.();
        gate?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      }}
      onViewPlan={() => onOpenInspector('terminal')}
      onCancelCompact={() => void onCancelCompact()}
      {...(lastUserMessage
        ? {
            onRetry: () => {
              void onRetryLastUser(lastUserMessage.id);
            },
          }
        : {})}
      permissionMode={effectiveRunMode}
      onOpenPermissions={() => openSettingsSection('permissions')}
      locale={locale}
      appearanceMode={appearanceMode}
      sessionsExpanded={sessionsExpanded}
      onToggleSessions={() => {
        shell.toggleSessions();
      }}
      canGoBack={shell.canGoBack}
      canGoForward={shell.canGoForward}
      onGoBack={() => {
        shell.goBack();
      }}
      onGoForward={() => {
        shell.goForward();
      }}
      onOpenSkills={() => openSettingsSection('skills')}
      onOpenMcp={() => openSettingsSection('tools')}
      onToggleAppearance={onToggleAppearance}
      onOpenSettings={() => openSettingsSection('general')}
      workPanelOpen={workPanelOpen}
      onToggleWorkPanel={() => shell.toggleInspector(rightPanelTab)}
      {...(activeSessionOrigin ? { origin: activeSessionOrigin } : {})}
      {...(activeSessionOrigin?.kind === 'fork'
        ? {
            onReturnToRoot: () => void onResumeSession(activeSessionOrigin.rootSessionId),
          }
        : {})}
      {...(props.onOpenSessionSearch ? { onOpenSearch: props.onOpenSessionSearch } : {})}
      trailing={props.trailing}
    />
  );
}
