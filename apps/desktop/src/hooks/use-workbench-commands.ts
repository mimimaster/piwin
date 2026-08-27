/**
 * Palette / shortcut dispatch and the instant appearance flip.
 */
import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { appearanceToggleBlockedNotice, planAppearanceToggle } from '../appearance-toggle';
import { buildAppearanceTheme } from '../appearance-tokens';
import type { DesktopCommandId } from '../desktop-commands';
import { saveDesktopLocale, type DesktopLocale } from '../desktop-locale';
import type { NotificationAction } from '../notification-queue';
import type { RightPanelTab } from '../right-panel';
import { runDesktopCommand } from '../run-desktop-command';
import type { ShellSettingsSection } from '../shell-navigation';
import { useDesktopShortcuts } from '../use-desktop-shortcuts';
import { saveDesktopPreferences, type DesktopPreferences } from '../ui-preferences';

type ShellCommands = {
  openInspector: (tab?: RightPanelTab | null) => void;
  openSettings: (section: ShellSettingsSection) => void;
  toggleSessions: () => void;
  toggleInspector: (tab?: RightPanelTab | null) => void;
  rememberTrigger: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
};

export type UseWorkbenchCommandsArgs = {
  activeTheme: ThemeManifest;
  preferences: DesktopPreferences;
  setPreferences: Dispatch<SetStateAction<DesktopPreferences>>;
  desktopLocale: DesktopLocale;
  setDesktopLocale: Dispatch<SetStateAction<DesktopLocale>>;
  dispatchNotification: Dispatch<NotificationAction>;
  onThemeApplied: (theme: ThemeManifest) => void;
  shell: ShellCommands;
  handleStartNewSession: () => void | Promise<void>;
  handleOpenWorkspaceClick: () => void | Promise<void>;
  handleAbort: () => void | Promise<void>;
  openSessionSearch: () => void;
};

export function useWorkbenchCommands(args: UseWorkbenchCommandsArgs) {
  const {
    activeTheme,
    preferences,
    setPreferences,
    desktopLocale,
    setDesktopLocale,
    dispatchNotification,
    onThemeApplied,
    shell,
    handleStartNewSession,
    handleOpenWorkspaceClick,
    handleAbort,
    openSessionSearch,
  } = args;

  const handleToggleAppearance = useCallback((): void => {
    const plan = planAppearanceToggle({
      visualStyle: activeTheme.visualStyle,
      mode: activeTheme.mode,
      preferences,
    });
    if (plan.kind === 'blocked-by-theme-package') {
      dispatchNotification({
        type: 'notify/push',
        notification: {
          level: 'info',
          message: appearanceToggleBlockedNotice(desktopLocale),
        },
      });
      return;
    }
    setPreferences(plan.nextPreferences);
    saveDesktopPreferences(plan.nextPreferences);
    onThemeApplied(buildAppearanceTheme(plan.nextMode, plan.nextThemeSettings));
  }, [
    activeTheme.mode,
    activeTheme.visualStyle,
    desktopLocale,
    dispatchNotification,
    onThemeApplied,
    preferences,
    setPreferences,
  ]);

  const openRightTab = useCallback(
    (tab: RightPanelTab): void => {
      shell.openInspector(tab);
    },
    [shell],
  );

  const openSettingsSection = useCallback(
    (section: ShellSettingsSection): void => {
      shell.openSettings(section);
    },
    [shell],
  );

  const handleDesktopCommand = useCallback(
    (commandId: DesktopCommandId): void => {
      runDesktopCommand(commandId, {
        onNewSession: handleStartNewSession,
        onOpenWorkspace: handleOpenWorkspaceClick,
        onStopRun: handleAbort,
        openSessionSearch,
        focusComposer: () => {
          document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
        },
        openSettings: () => {
          shell.openSettings('general');
        },
        toggleSessions: () => {
          shell.toggleSessions();
        },
        toggleInspector: (tab) => {
          shell.toggleInspector(tab);
        },
        openInspector: openRightTab,
      });
    },
    [
      handleAbort,
      handleOpenWorkspaceClick,
      handleStartNewSession,
      openRightTab,
      openSessionSearch,
      shell,
    ],
  );

  useDesktopShortcuts({
    onOpenPalette: () => {
      shell.rememberTrigger();
      shell.setCommandPaletteOpen(true);
    },
    onCommand: handleDesktopCommand,
  });

  useEffect(() => {
    document.documentElement.lang = desktopLocale;
  }, [desktopLocale]);

  const handleLocaleChange = useCallback(
    (locale: DesktopLocale): void => {
      setDesktopLocale(locale);
      saveDesktopLocale(locale);
    },
    [setDesktopLocale],
  );

  return {
    handleToggleAppearance,
    openRightTab,
    openSettingsSection,
    handleDesktopCommand,
    handleLocaleChange,
  };
}
