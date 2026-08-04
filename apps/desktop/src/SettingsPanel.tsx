/**
 * Settings panel: owns config loading/saving, the web-tools draft, and the
 * host-request callbacks; renders the SettingsShell. All sections render
 * through the section registry (settings/pages).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
  HostStatusData,
  ThemeManifest,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import type { SkillsPanelProps } from './SkillsPanel';
import type { McpPanelProps } from './McpPanel';
import type { ExtensionsPanelProps } from './ExtensionsPanel';
import type { PluginsPanelProps } from './PluginsPanel';
import type { PromptsPanelProps } from './PromptsPanel';
import type { ThemePanelProps } from './ThemePanel';
import type { PetPanelProps } from './PetPanel';
import type { AutomationPanelProps } from './AutomationPanel';
import { hideUiNotification, showUiNotification } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import type { DesktopPreferences } from './ui-preferences';
import { type SettingsSectionId } from './settings/section-registry';
import { webToDraft, draftToWeb, type DraftWeb } from './settings/web-draft';
import { SettingsShell } from './settings/settings-shell';
import type { SettingsConfigRequest, SettingsContextValue } from './settings/settings-context';

type SettingsPanelProps = {
  request: SettingsConfigRequest;
  onSaved?: (config: PiwinConfig) => void;
  preferences: DesktopPreferences;
  onPreferencesChange: (prefs: DesktopPreferences) => void;
  projectPath: string | null;
  /** Whether the open project is trusted (ADR 0019 §2 — gates project allow rules + bypass). */
  projectTrusted: boolean;
  requestSkills: SkillsPanelProps['request'];
  requestMcp: McpPanelProps['request'];
  requestExtensions: ExtensionsPanelProps['request'];
  requestPlugins: PluginsPanelProps['request'];
  requestPrompts: PromptsPanelProps['request'];
  requestTheme: ThemePanelProps['request'];
  requestPet: PetPanelProps['request'];
  requestAutomation: AutomationPanelProps['request'];
  requestSubAgent?: import('./SubAgentPanel').SubAgentPanelProps['request'];
  activeSessionId?: string | null;
  activeTheme: ThemeManifest;
  /** Live child summaries from host pushes (keyed by childSessionId). */
  subagentChildren?: Record<string, import('@piwin/contracts').SessionSummary>;
  onOpenSubagentSession?: (sessionId: string) => void;
  onThemeApplied: ThemePanelProps['onApplied'];
  onPetActiveChanged: PetPanelProps['onActiveChanged'];
  initialSection?: SettingsSectionId;
  hostStatus?: HostStatusData | null;
  /** Callback to close the modal sub-form. */
  onClose?: (() => void) | undefined;
};

export function SettingsPanel({
  request,
  onSaved,
  preferences,
  onPreferencesChange,
  projectPath,
  projectTrusted,
  requestSkills,
  requestMcp,
  requestExtensions,
  requestPlugins,
  requestPrompts,
  requestTheme,
  requestPet,
  requestAutomation,
  requestSubAgent,
  activeSessionId = null,
  activeTheme,
  subagentChildren,
  onOpenSubagentSession,
  onThemeApplied,
  onPetActiveChanged,
  initialSection,
  hostStatus = null,
  onClose,
}: SettingsPanelProps) {
  const { locale } = useDesktopLocale();
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [root, setRoot] = useState('~/.piwin');
  const [error, setErrorState] = useState<string | null>(null);
  const [info, setInfoMessage] = useState<string | null>(null);
  const [infoTone, setInfoTone] = useState<'info' | 'success' | 'warning'>('info');
  const [webDraft, setWebDraft] = useState<DraftWeb>(webToDraft(createDefaultWebConfig()));
  const [saving, setSaving] = useState(false);
  const [settingsNav, setSettingsNav] = useState<SettingsSectionId>(initialSection ?? 'general');

  const setError = useCallback((message: string | null): void => {
    setErrorState(message);
    if (message) {
      setInfoMessage(null);
    }
  }, []);

  // Escape is owned by useShellLayout so focus returns to the opener.
  useEffect(() => {
    void (async () => {
      const response = await request({ type: 'config/get' });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { config: PiwinConfig; root: string };
      setConfig(data.config);
      setRoot(data.root);
      setWebDraft(webToDraft(data.config.web ?? createDefaultWebConfig()));
    })();
  }, [request, setError]);

  useEffect(() => {
    if (initialSection) {
      setSettingsNav(initialSection);
    }
  }, [initialSection]);

  // All Settings feedback uses the shared Mantine notification host rather
  // than a page-local alert so placement, sizing, and dismissal stay uniform.
  useEffect(() => {
    const message = error ?? info;
    if (!message) {
      return;
    }

    const isError = error !== null;
    const notificationId = showUiNotification({
      tone: isError ? 'error' : infoTone,
      ...(isError ? { title: locale === 'zh-CN' ? '设置错误' : 'Settings error' } : {}),
      message,
      autoClose: isError ? 6000 : 3500,
      onClose: () => {
        if (isError) {
          setErrorState(null);
        } else {
          setInfoMessage(null);
        }
      },
    });

    return () => {
      hideUiNotification(notificationId);
    };
  }, [error, info, infoTone, locale]);

  const setInfo = useCallback(
    (message: string | null, tone: 'info' | 'success' | 'warning' = 'info'): void => {
      setInfoTone(tone);
      setInfoMessage(message);
      if (message) {
        setErrorState(null);
      }
    },
    [],
  );

  const saveConfig = useCallback(
    async (next: PiwinConfig): Promise<boolean> => {
      setSaving(true);
      setError(null);
      setInfo(null);
      const response = await request({ type: 'config/set', config: next });
      setSaving(false);
      if (!response.success) {
        setError(response.error);
        return false;
      }
      setConfig(next);
      onSaved?.(next);
      return true;
    },
    [request, onSaved, setError, setInfo],
  );

  const discoverProviderModels = useCallback(
    async (
      provider: ModelProviderConfig,
      options?: { apiKey?: string },
    ): Promise<ModelDiscoveryResult> => {
      const response = await request({
        type: 'models/discover',
        provider,
        ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as ModelDiscoveryResult;
    },
    [request],
  );

  const testProviderModel = useCallback(
    async (
      provider: ModelProviderConfig,
      modelId: string,
      options?: { apiKey?: string },
    ): Promise<{ durationMs: number }> => {
      const response = await request({
        type: 'models/test',
        provider,
        modelId,
        ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as { durationMs: number };
    },
    [request],
  );

  const searchModelCatalog = useCallback(
    async (
      input?: import('@piwin/contracts').ModelCatalogSearchRequest,
    ): Promise<import('@piwin/contracts').ModelCatalogSearchResult> => {
      const response = await request({
        type: 'models/catalog/search',
        ...(input ? { input } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as import('@piwin/contracts').ModelCatalogSearchResult;
    },
    [request],
  );

  const searchImageModelCatalog = useCallback(async (): Promise<
    import('@piwin/contracts').ImageModelCatalogSearchResult
  > => {
    const response = await request({
      type: 'models/image-catalog/search',
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data as import('@piwin/contracts').ImageModelCatalogSearchResult;
  }, [request]);

  const storeProviderSecret = useCallback(
    async (providerId: string, secret: string): Promise<string> => {
      const response = await request({ type: 'secrets/set', providerId, secret });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as { apiKeyRef?: string };
      if (!data.apiKeyRef?.trim()) {
        throw new Error(locale === 'zh-CN' ? '保存密钥失败。' : 'Failed to store secret.');
      }
      return data.apiKeyRef;
    },
    [request, locale],
  );

  const loadProviderSecret = useCallback(
    async (providerId: string): Promise<string | null> => {
      const response = await request({ type: 'secrets/get', providerId });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as { secret?: string };
      return data.secret?.trim() ? data.secret : null;
    },
    [request],
  );

  const testWebSearchSource = useCallback(
    async (
      input: import('@piwin/contracts').WebSearchTestInput,
    ): Promise<import('@piwin/contracts').WebSearchTestResult> => {
      const response = await request({ type: 'web/test-search-source', webTest: input });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as import('@piwin/contracts').WebSearchTestResult;
    },
    [request],
  );

  const saveWeb = useCallback(
    async (draftOverride?: DraftWeb): Promise<boolean> => {
      if (!config) return false;
      const draftToSave = draftOverride ?? webDraft;
      const next: PiwinConfig = {
        ...config,
        web: draftToWeb(draftToSave),
      };
      if (await saveConfig(next)) {
        setWebDraft(draftToSave);
        setInfo(
          locale === 'zh-CN'
            ? '已保存 Web 工具设置；新会话将使用新的提供商密钥。'
            : 'Web tool settings saved. New sessions will use the updated provider keys.',
          'success',
        );
        return true;
      }
      return false;
    },
    [config, webDraft, saveConfig, locale, setInfo],
  );

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      request,
      config,
      root,
      saving,
      setError,
      setInfo,
      saveConfig,
      webDraft,
      setWebDraft,
      saveWeb,
      preferences,
      onPreferencesChange,
      projectPath,
      projectTrusted,
      hostStatus,
      activeSessionId,
      onOpenSubagentSession,
      selectSection: setSettingsNav,
      requestSkills,
      requestMcp,
      requestExtensions,
      requestPlugins,
      requestPrompts,
      requestTheme,
      requestPet,
      requestAutomation,
      requestSubAgent,
      activeTheme,
      ...(subagentChildren ? { subagentChildren } : {}),
      onThemeApplied,
      onPetActiveChanged,
      discoverProviderModels,
      testProviderModel,
      searchModelCatalog,
      searchImageModelCatalog,
      storeProviderSecret,
      loadProviderSecret,
      testWebSearchSource,
    }),
    [
      request,
      config,
      root,
      saving,
      setError,
      setInfo,
      saveConfig,
      webDraft,
      saveWeb,
      preferences,
      onPreferencesChange,
      projectPath,
      projectTrusted,
      hostStatus,
      activeSessionId,
      onOpenSubagentSession,
      requestSkills,
      requestMcp,
      requestExtensions,
      requestPlugins,
      requestPrompts,
      requestTheme,
      requestPet,
      requestAutomation,
      requestSubAgent,
      activeTheme,
      subagentChildren,
      onThemeApplied,
      onPetActiveChanged,
      discoverProviderModels,
      testProviderModel,
      searchModelCatalog,
      searchImageModelCatalog,
      storeProviderSecret,
      loadProviderSecret,
      testWebSearchSource,
    ],
  );

  return (
    <SettingsShell
      activeSection={settingsNav}
      onSelectSection={setSettingsNav}
      contextValue={contextValue}
      onClose={onClose}
    />
  );
}
