/**
 * Run-mode override, lastSession persist, and settings-panel config callbacks.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  resolvePermissionPreset,
  resolvePreset,
  type PermissionPreset,
  type PiwinConfig,
  type SessionScope,
} from '@piwin/contracts';
import type { SaveSettingsInOrder } from './use-settings-save-queue';
import {
  lastSessionPersistUnchanged,
  planLastSessionPersist,
  type LastSessionPointer,
} from '../workbench/workbench-session-lifecycle';
import { saveDesktopPreferences, type DesktopPreferences } from '../platform/ui-preferences';

export type UseWorkbenchDesktopConfigArgs = {
  config: PiwinConfig | null;
  setConfig: Dispatch<SetStateAction<PiwinConfig | null>>;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
  setPreferences: Dispatch<SetStateAction<DesktopPreferences>>;
  saveSettingsInOrder: SaveSettingsInOrder;
  activeSessionId: string | null;
  activeScope: SessionScope;
};

export function useWorkbenchDesktopConfig(args: UseWorkbenchDesktopConfigArgs): {
  /** What the run-mode controls show: this session's pick, else the Host default. */
  effectiveRunMode: PermissionPreset;
  /** Sent with a prompt: only an explicit pick for this session; undefined follows Host config. */
  runModeForPrompt: PermissionPreset | undefined;
  /** True when this session has its own pick (false = following the Host default). */
  runModeIsOverride: boolean;
  /** Host config preset (what "follow Host" means right now). */
  hostRunMode: PermissionPreset;
  /** `null` clears this session's pick so it follows the Host default again. */
  handleRunModeChange: (preset: PermissionPreset | null) => void;
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

  // Run mode is per conversation: a pick in one session never leaks into
  // another, and a session without a pick follows the Host config (the prompt
  // then omits `permissionPreset`). The blank composer keeps its pick under
  // DRAFT_RUN_MODE_KEY until first send binds it to the created session.
  const [runModeOverrides, setRunModeOverrides] = useState<ReadonlyMap<string, PermissionPreset>>(
    () => new Map(),
  );
  const overrideKey = activeSessionId ?? DRAFT_RUN_MODE_KEY;
  const runModeOverride = runModeOverrides.get(overrideKey) ?? null;
  const configPreset: PermissionPreset = resolvePermissionPreset(config?.permissions);
  const effectiveRunMode: PermissionPreset = runModeOverride ?? configPreset;

  const overrideKeyRef = useRef(overrideKey);
  overrideKeyRef.current = overrideKey;
  const handleRunModeChange = useCallback((nextPreset: PermissionPreset | null): void => {
    setRunModeOverrides((current) => setRunModeOverride(current, overrideKeyRef.current, nextPreset));
  }, []);

  const previousSessionRef = useRef(activeSessionId);
  useEffect(() => {
    const previous = previousSessionRef.current;
    previousSessionRef.current = activeSessionId;
    if (previous === null && activeSessionId !== null) {
      setRunModeOverrides((current) => bindDraftRunMode(current, activeSessionId));
    }
  }, [activeSessionId]);

  const handleRunModeSetDefault = useCallback(
    (nextPreset: PermissionPreset): void => {
      if (!config) return;
      const resolved = resolvePreset(nextPreset);
      const nextConfig: PiwinConfig = {
        ...config,
        permissions: {
          mode: nextPreset === 'yolo' && config.permissions?.mode === 'unrestricted'
            ? 'unrestricted'
            : resolved.mode,
          preset: nextPreset,
        },
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

  const lastPersistedSessionRef = useRef<LastSessionPointer | null>(null);

  useEffect(() => {
    const plan = planLastSessionPersist({
      config,
      activeSessionId,
      activeScope,
      alreadyPersisted: lastPersistedSessionRef.current,
    });
    if (plan.kind === 'skip') {
      return;
    }
    lastPersistedSessionRef.current = plan.lastSession;
    if (plan.kind === 'mark-synced' || !config) {
      return;
    }
    const lastSession = plan.lastSession;
    const nextConfig: PiwinConfig = {
      ...config,
      desktop: { ...config.desktop, lastSession },
    };
    setConfig(nextConfig);
    void saveSettingsInOrder(
      (currentConfig) => [
        {
          kind: 'replace-domain',
          domain: 'desktop',
          value: {
            ...currentConfig.desktop,
            lastSession,
          } as NonNullable<PiwinConfig['desktop']>,
        },
      ],
      { notify: false },
    ).then((ok) => {
      if (
        !ok &&
        lastSessionPersistUnchanged(
          lastPersistedSessionRef.current === null
            ? undefined
            : { lastSession: lastPersistedSessionRef.current },
          lastSession,
        )
      ) {
        lastPersistedSessionRef.current = null;
      }
    });
  }, [activeScope, activeSessionId, config, saveSettingsInOrder, setConfig]);

  return {
    effectiveRunMode,
    runModeForPrompt: runModeOverride ?? undefined,
    runModeIsOverride: runModeOverride !== null,
    hostRunMode: configPreset,
    handleRunModeChange,
    handleRunModeSetDefault,
    handleSettingsSaved,
    handleSettingsPreferencesChange,
  };
}

export const DRAFT_RUN_MODE_KEY = '__draft__';

export function setRunModeOverride(
  current: ReadonlyMap<string, PermissionPreset>,
  key: string,
  preset: PermissionPreset | null,
): ReadonlyMap<string, PermissionPreset> {
  const next = new Map(current);
  if (preset === null) next.delete(key);
  else next.set(key, preset);
  return next;
}

/** First send: the blank composer's pick becomes the created session's pick. */
export function bindDraftRunMode(
  current: ReadonlyMap<string, PermissionPreset>,
  sessionId: string,
): ReadonlyMap<string, PermissionPreset> {
  const draft = current.get(DRAFT_RUN_MODE_KEY);
  if (draft === undefined) return current;
  const next = new Map(current);
  next.delete(DRAFT_RUN_MODE_KEY);
  if (!next.has(sessionId)) next.set(sessionId, draft);
  return next;
}
