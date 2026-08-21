/**
 * Settings panel: owns config loading/saving, the web-tools draft, and the
 * host-request callbacks; renders the SettingsShell. All sections render
 * through the section registry (settings/pages).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
  HostStatusData,
  ImageGenerationTestResult,
  ThemeManifest,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import type { SkillsPanelProps } from './SkillsPanel';
import type { McpPanelProps } from './McpPanel';
import type { ExtensionsPanelProps } from './ExtensionsPanel';
import type { PluginsPanelProps } from './PluginsPanel';
import type { PromptsPanelProps } from './PromptsPanel';
import type { PetPanelProps } from './PetPanel';
import type { AutomationPanelProps } from './AutomationPanel';
import { hideUiNotification, showUiNotification } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import type { DesktopPreferences } from './ui-preferences';
import { type SettingsSectionId } from './settings/section-registry';
import { webToDraft, draftToWeb, preserveWebCliLaunchers, type DraftWeb } from './settings/web-draft';
import { isRemoteCommandGapError } from './remote-command-gap.js';
import { interpretSettingsLoadResponse } from './settings/settings-view-config';
import { SettingsShell } from './settings/settings-shell';
import type { SettingsConfigRequest, SettingsContextValue } from './settings/settings-context';
import './styles/settings.css';

type SettingsPanelProps = {
  request: SettingsConfigRequest;
  hostClient?: SettingsContextValue['hostClient'];
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
  requestPet: PetPanelProps['request'];
  requestAutomation: AutomationPanelProps['request'];
  requestSubAgent?: import('./SubAgentPanel').SubAgentPanelProps['request'];
  activeSessionId?: string | null;
  activeTheme: ThemeManifest;
  /** Live child summaries from host pushes (keyed by childSessionId). */
  subagentChildren?: Record<string, import('@piwin/contracts').SessionSummary>;
  subagentBatches?: Record<string, import('@piwin/contracts').SubagentBatchProjection>;
  onOpenSubagentSession?: (sessionId: string) => void;
  onThemeApplied: (theme: ThemeManifest) => void;
  onPetActiveChanged: PetPanelProps['onActiveChanged'];
  initialSection?: SettingsSectionId;
  hostStatus?: HostStatusData | null;
  /** Workbench copy of Host settings; used if this panel's own load fails. */
  seedConfig?: PiwinConfig;
  /** Callback to leave the settings route. */
  onClose?: (() => void) | undefined;
  /** Keep the shell route in sync when a settings nav item is selected. */
  onSectionChange?: (section: SettingsSectionId) => void;
};

export const SettingsPanel = memo(function SettingsPanel({
  request,
  hostClient,
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
  requestPet,
  requestAutomation,
  requestSubAgent,
  activeSessionId = null,
  activeTheme,
  subagentChildren,
  subagentBatches,
  onOpenSubagentSession,
  onThemeApplied,
  onPetActiveChanged,
  initialSection,
  hostStatus = null,
  seedConfig,
  onClose,
  onSectionChange,
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

  const selectSection = useCallback(
    (section: SettingsSectionId): void => {
      setSettingsNav(section);
      onSectionChange?.(section);
    },
    [onSectionChange],
  );

  const setError = useCallback((message: string | null): void => {
    if (message !== null && isRemoteCommandGapError(message)) {
      return;
    }
    setErrorState(message);
    if (message) {
      setInfoMessage(null);
    }
  }, []);

  // Escape is owned by useShellLayout so focus returns to the opener.
  useEffect(() => {
    void (async () => {
      const remote = hostClient?.getTransport?.() === 'remote';
      const canReadSettings = hostClient?.supportsCommand?.('settings/get') !== false;
      try {
        const response =
          remote && !canReadSettings ? undefined : await request({ type: 'config/get' });
        const loaded = interpretSettingsLoadResponse({
          remote,
          canReadSettings,
          ...(response === undefined ? {} : { response }),
        });
        if (loaded.kind === 'error') {
          setError(loaded.error);
          if (seedConfig) {
            setConfig(seedConfig);
            setWebDraft(webToDraft(seedConfig.web ?? createDefaultWebConfig()));
          }
          return;
        }
        setConfig(loaded.config);
        setRoot(loaded.root);
        setWebDraft(webToDraft(loaded.config.web ?? createDefaultWebConfig()));
      } catch (loadError) {
        if (seedConfig) {
          setConfig(seedConfig);
          setWebDraft(webToDraft(seedConfig.web ?? createDefaultWebConfig()));
        } else {
          const loaded = interpretSettingsLoadResponse({
            remote,
            canReadSettings: false,
          });
          if (loaded.kind === 'error') {
            setError(loaded.error);
            return;
          }
          setConfig(loaded.config);
          setRoot(loaded.root);
          setWebDraft(webToDraft(loaded.config.web ?? createDefaultWebConfig()));
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
  }, [hostClient, request, seedConfig, setError]);

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

  const remoteSettingsReadOnly =
    hostClient?.getTransport?.() === 'remote' &&
    hostClient.supportsCommand?.('settings/apply') === false;

  const saveConfig = useCallback(
    async (next: PiwinConfig): Promise<boolean> => {
      setSaving(true);
      setError(null);
      setInfo(null);
      try {
        const response = await request({ type: 'config/set', config: next });
        if (!response.success) {
          setError(response.error);
          return false;
        }
        setConfig(next);
        onSaved?.(next);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [onSaved, request, setError, setInfo],
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

  const testImageGenerationModel = useCallback(
    async (
      provider: ModelProviderConfig,
      modelId: string,
      options?: { apiKey?: string; prompt?: string },
    ): Promise<ImageGenerationTestResult> => {
      const response = await request({
        type: 'models/image-test',
        provider,
        modelId,
        ...(options?.prompt?.trim() ? { prompt: options.prompt.trim() } : {}),
        ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as ImageGenerationTestResult;
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
        if (isRemoteCommandGapError(response.error)) {
          return null;
        }
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
        web: preserveWebCliLaunchers(draftToWeb(draftToSave), config.web),
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
      ...(hostClient ? { hostClient } : {}),
      config,
      root,
      saving,
      remoteSettingsReadOnly,
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
      selectSection,
      requestSkills,
      requestMcp,
      requestExtensions,
      requestPlugins,
      requestPrompts,
      requestPet,
      requestAutomation,
      requestSubAgent,
      activeTheme,
      ...(subagentChildren ? { subagentChildren } : {}),
      ...(subagentBatches ? { subagentBatches } : {}),
      onThemeApplied,
      onPetActiveChanged,
      discoverProviderModels,
      testProviderModel,
      testImageGenerationModel,
      searchModelCatalog,
      searchImageModelCatalog,
      storeProviderSecret,
      loadProviderSecret,
      testWebSearchSource,
    }),
    [
      request,
      hostClient,
      config,
      root,
      saving,
      remoteSettingsReadOnly,
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
      requestPet,
      requestAutomation,
      requestSubAgent,
      activeTheme,
      subagentChildren,
      subagentBatches,
      onThemeApplied,
      onPetActiveChanged,
      discoverProviderModels,
      testProviderModel,
      testImageGenerationModel,
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
      onSelectSection={selectSection}
      contextValue={contextValue}
      onClose={onClose}
    />
  );
});
