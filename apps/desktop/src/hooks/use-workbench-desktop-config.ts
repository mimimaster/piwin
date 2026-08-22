/**
 * Run-mode override, lastSession persist, and settings-panel config callbacks.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  resolvePermissionPreset,
  resolvePreset,
  type PermissionPreset,
  type PiwinConfig,
  type SessionScope,
  type SettingsMutation,
} from '@piwin/contracts';
import { lastSessionPersistUnchanged } from '../workbench-session-lifecycle';
import { saveDesktopPreferences, type DesktopPreferences } from '../ui-preferences';

export type UseWorkbenchDesktopConfigArgs = {
  config: PiwinConfig | null;
  setConfig: Dispatch<SetStateAction<PiwinConfig | null>>;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
  setPreferences: Dispatch<SetStateAction<DesktopPreferences>>;
  saveSettingsInOrder: (
    buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[],
  ) => Promise<void>;
  activeSessionId: string | null;
  activeScope: SessionScope;
};

export function useWorkbenchDesktopConfig(args: UseWorkbenchDesktopConfigArgs): {
  effectiveRunMode: PermissionPreset;
  handleRunModeChange: (preset: PermissionPreset) => void;
  handleRunModeSetDefault: (preset: PermissionPreset) => void;
  handleSettingsSaved: (next: PiwinConfig) => void;
  handleSettingsPreferencesChange: (next: DesktopPreferences) => void;
} {
  const {
    config,
    setConfig,
    setPreferences,
    saveSettingsInOrder,
    activeSessionId,
    activeScope,
  } = args;

  const [runModeOverride, setRunModeOverride] = useState<PermissionPreset | null>(null);
  const configPreset: PermissionPreset = resolvePermissionPreset(config?.permissions);
  const effectiveRunMode: PermissionPreset = runModeOverride ?? configPreset;

  const handleRunModeChange = useCallback((nextPreset: PermissionPreset): void => {
    setRunModeOverride(nextPreset);
  }, []);

  const handleRunModeSetDefault = useCallback(
    (nextPreset: PermissionPreset): void => {
      if (!config) return;
      const resolved = resolvePreset(nextPreset);
      const nextConfig: PiwinConfig = {
        ...config,
        permissions: { mode: resolved.mode, preset: nextPreset },
      };
      setConfig(nextConfig);
      void saveSettingsInOrder(() => [
        {
          kind: 'replace-domain',
          domain: 'permissions',
          value: nextConfig.permissions,
        },
      ]);
    },
    [config, saveSettingsInOrder, setConfig],
  );

  const handleSettingsPreferencesChange = useCallback((next: DesktopPreferences): void => {
    setPreferences(next);
    saveDesktopPreferences(next);
  }, [setPreferences]);

  const handleSettingsSaved = useCallback(
    (next: PiwinConfig): void => {
      setConfig(next);
      // Catalog/default changes must not yank an open session's composer onto
      // the product default. `resolveComposerModelSelection` keeps a valid
      // pick, or restores the session last-used model when the pick vanished.
    },
    [setConfig],
  );

  useEffect(() => {
    if (!config || !activeSessionId) {
      return;
    }
    const lastSession = {
      sessionId: activeSessionId,
      scope: activeScope,
    };
    if (lastSessionPersistUnchanged(config.desktop, lastSession)) {
      return;
    }
    const nextConfig: PiwinConfig = {
      ...config,
      desktop: { ...config.desktop, lastSession },
    };
    setConfig(nextConfig);
    void saveSettingsInOrder((currentConfig) => [
      {
        kind: 'replace-domain',
        domain: 'desktop',
        value: {
          ...currentConfig.desktop,
          lastSession,
        } as NonNullable<PiwinConfig['desktop']>,
      },
    ]);
  }, [activeScope, activeSessionId, config, saveSettingsInOrder, setConfig]);

  return {
    effectiveRunMode,
    handleRunModeChange,
    handleRunModeSetDefault,
    handleSettingsSaved,
    handleSettingsPreferencesChange,
  };
}
