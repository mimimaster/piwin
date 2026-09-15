/**
 * Settings panel: owns config loading/saving, the web-tools draft, and the
 * host-request callbacks; renders the SettingsShell. All sections render
 * through the section registry (settings/pages).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useDesktopLocale } from './desktop-locale-context';
import type { DesktopPreferences } from './ui-preferences';
import { type SettingsSectionId } from './settings/section-registry';
import { webToDraft, draftToWeb, preserveWebCliLaunchers, type DraftWeb } from './settings/web-draft';
import { hostFailureNotice } from './host-problem-copy.js';
import { isRemoteCommandGapError } from './remote-command-gap.js';
import {
  applyHostProviderSnapshot,
  configFromSettingsWriteResponse,
  interpretSettingsLoadResponse,
  knowledgeWriteRetained,
  providerListWriteRetained,
  shouldSyncSettingsProviders,
} from './settings/settings-view-config';
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
  subagentInvocations?: Record<string, import('@piwin/contracts').SubagentInvocation>;
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
  subagentInvocations,
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
  const seedConfigRef = useRef(seedConfig);
  seedConfigRef.current = seedConfig;
  const [config, setConfig] = useState<PiwinConfig | null>(seedConfig ?? null);
  const [root, setRoot] = useState('~/.piwin');
  const [error, setErrorState] = useState<string | null>(null);
  const [info, setInfoMessage] = useState<string | null>(null);
  const [infoTone, setInfoTone] = useState<'info' | 'success' | 'warning'>('info');
  const [webDraft, setWebDraft] = useState<DraftWeb>(webToDraft(createDefaultWebConfig()));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  savingRef.current = saving;
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
    const mapped =
      message === null
        ? null
        : hostFailureNotice(
            {
              type: 'response',
              command: 'config/get',
              success: false,
              error: message,
            },
            locale,
          ) || message;
    setErrorState(mapped);
    if (mapped) {
      setInfoMessage(null);
    }
  }, [locale]);

  // Load once per Host connection. `seedConfig` updates after save must not
  // refetch and clobber the form (reranker/extras looked "unsaved").
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remote = hostClient?.getTransport?.() === 'remote';
      const canReadSettings = hostClient?.supportsCommand?.('settings/get') !== false;
      try {
        const response =
          remote && !canReadSettings ? undefined : await request({ type: 'config/get' });
        if (cancelled) return;
        const loaded = interpretSettingsLoadResponse({
          remote,
          canReadSettings,
          ...(response === undefined ? {} : { response }),
        });
        if (loaded.kind === 'error') {
          setError(loaded.error);
          const seed = seedConfigRef.current;
          if (seed) {
            setConfig(seed);
            setWebDraft(webToDraft(seed.web ?? createDefaultWebConfig()));
          }
          return;
        }
        setConfig(loaded.config);
        setRoot(loaded.root);
        setWebDraft(webToDraft(loaded.config.web ?? createDefaultWebConfig()));
      } catch (loadError) {
        if (cancelled) return;
        const seed = seedConfigRef.current;
        if (seed) {
          setConfig(seed);
          setWebDraft(webToDraft(seed.web ?? createDefaultWebConfig()));
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
    return () => {
      cancelled = true;
    };
  }, [hostClient, request, setError]);

  // OAuth login/logout writes providers on Host. This panel keeps its own
  // snapshot so knowledge drafts survive seedConfig flaps — still pull the
  // provider list or Models keeps a logged-out Grok row.
  useEffect(() => {
    if (!hostClient) {
      return;
    }
    let cancelled = false;
    const syncProviders = async (): Promise<void> => {
      if (savingRef.current) {
        return;
      }
      const remote = hostClient.getTransport?.() === 'remote';
      const canReadSettings = hostClient.supportsCommand?.('settings/get') !== false;
      if (remote && !canReadSettings) {
        return;
      }
      try {
        const response = await request({ type: 'config/get' });
        if (cancelled || savingRef.current) {
          return;
        }
        const loaded = interpretSettingsLoadResponse({
          remote,
          canReadSettings,
          response,
        });
        if (loaded.kind === 'error') {
          return;
        }
        setConfig((current) =>
          current ? applyHostProviderSnapshot(current, loaded.config) : loaded.config,
        );
      } catch {
        // Keep the open form; the next auth/settings push can retry.
      }
    };
    return hostClient.subscribe((message) => {
      if (message.type === 'settings/updated') {
        if (shouldSyncSettingsProviders(message.changedDomains)) {
          void syncProviders();
        }
        return;
      }
      if (message.type === 'auth/updated' || message.type === 'auth/login-finished') {
        void syncProviders();
      }
    });
  }, [hostClient, request]);

  useEffect(() => {
    if (initialSection) {
      setSettingsNav(initialSection);
    }
  }, [initialSection]);

  // Shared settings bubble (`.settings-feedback-host`) auto-dismisses so pages
  // only call setInfo/setError — no page-local overlay that covers a FieldRow.
  useEffect(() => {
    const message = error ?? info;
    if (!message) {
      return;
    }

    const isError = error !== null;
    const timeoutId = window.setTimeout(
      () => {
        if (isError) {
          setErrorState(null);
        } else {
          setInfoMessage(null);
        }
      },
      isError ? 6000 : infoTone === 'warning' ? 8000 : 3500,
    );
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [error, info, infoTone]);

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
          setError(hostFailureNotice(response, locale) || response.error);
          return false;
        }
        const stored = configFromSettingsWriteResponse(response, next);
        if (!knowledgeWriteRetained(next, stored)) {
          setError(
            locale === 'zh-CN'
              ? '当前 Host 没有保存重排 / 解析 / 专用模型。更新并重启 Host 后再保存，表单先留着。'
              : 'This Host did not persist reranker, parsers, or dedicated models. Update and restart the Host, then save again. Your form was kept.',
          );
          return false;
        }
        if (!providerListWriteRetained(next, stored)) {
          setError(
            locale === 'zh-CN'
              ? '当前 Host 没有按提交保存提供商列表。更新并重启 Host 后再保存。'
              : 'This Host did not persist the provider list you submitted. Update and restart the Host, then save again.',
          );
          return false;
        }
        setConfig(stored);
        onSaved?.(stored);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [locale, onSaved, request, setError, setInfo],
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
      ...(subagentInvocations ? { subagentInvocations } : {}),
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
      subagentInvocations,
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
      feedback={{ error, info, tone: infoTone }}
    />
  );
});
