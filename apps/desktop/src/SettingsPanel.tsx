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
  HostResponse,
  HostStatusData,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import type { SkillsPanelProps } from './SkillsPanel';
import type { McpPanelProps } from './McpPanel';
import type { ExtensionsPanelProps } from './ExtensionsPanel';
import type { PromptsPanelProps } from './PromptsPanel';
import type { ThemePanelProps } from './ThemePanel';
import type { PetPanelProps } from './PetPanel';
import type { AutomationPanelProps } from './AutomationPanel';
import { Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import type { DesktopPreferences } from './ui-preferences';
import { type SettingsSectionId } from './settings/section-registry';
import { webToDraft, draftToWeb, type DraftWeb } from './settings/web-draft';
import { SettingsShell } from './settings/settings-shell';
import type { SettingsContextValue } from './settings/settings-context';

type SettingsPanelProps = {
  request: (command: {
    type:
      | 'config/get'
      | 'config/set'
      | 'models/discover'
      | 'models/test'
      | 'secrets/set'
      | 'secrets/get'
      | 'project/permissions-list'
      | 'project/permissions-revoke';
    config?: PiwinConfig;
    provider?: ModelProviderConfig;
    apiKey?: string;
    modelId?: string;
    providerId?: string;
    secret?: string;
    path?: string;
    key?: string;
  }) => Promise<HostResponse>;
  onSaved?: (config: PiwinConfig) => void;
  preferences: DesktopPreferences;
  onPreferencesChange: (prefs: DesktopPreferences) => void;
  projectPath: string | null;
  requestSkills: SkillsPanelProps['request'];
  requestMcp: McpPanelProps['request'];
  requestExtensions: ExtensionsPanelProps['request'];
  requestPrompts: PromptsPanelProps['request'];
  requestTheme: ThemePanelProps['request'];
  requestPet: PetPanelProps['request'];
  requestAutomation: AutomationPanelProps['request'];
  requestSubAgent?: import('./SubAgentPanel').SubAgentPanelProps['request'];
  activeSessionId?: string | null;
  onOpenSubagentSession?: (sessionId: string) => void;
  onThemeApplied: ThemePanelProps['onApplied'];
  onPetActiveChanged: PetPanelProps['onActiveChanged'];
  initialSection?: SettingsSectionId;
  hostStatus?: HostStatusData | null;
};

export function SettingsPanel({
  request,
  onSaved,
  preferences,
  onPreferencesChange,
  projectPath,
  requestSkills,
  requestMcp,
  requestExtensions,
  requestPrompts,
  requestTheme,
  requestPet,
  requestAutomation,
  requestSubAgent,
  activeSessionId = null,
  onOpenSubagentSession,
  onThemeApplied,
  onPetActiveChanged,
  initialSection,
  hostStatus = null,
}: SettingsPanelProps) {
  const { locale } = useDesktopLocale();
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [root, setRoot] = useState('~/.piwin');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [webDraft, setWebDraft] = useState<DraftWeb>(webToDraft(createDefaultWebConfig()));
  const [saving, setSaving] = useState(false);
  const [settingsNav, setSettingsNav] = useState<SettingsSectionId>(initialSection ?? 'general');

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
  }, [request]);

  useEffect(() => {
    if (initialSection) {
      setSettingsNav(initialSection);
    }
  }, [initialSection]);

  // Success / info banners are transient; errors stay until next action.
  useEffect(() => {
    if (!info) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInfo(null);
    }, 3500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [info]);

  const saveConfig = useCallback(async (next: PiwinConfig): Promise<boolean> => {
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
  }, [request, onSaved]);

  const discoverProviderModels = useCallback(async (
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
  }, [request]);

  const testProviderModel = useCallback(async (
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
  }, [request]);

  const storeProviderSecret = useCallback(async (
    providerId: string,
    secret: string,
  ): Promise<string> => {
    const response = await request({ type: 'secrets/set', providerId, secret });
    if (!response.success) {
      throw new Error(response.error);
    }
    const data = response.data as { apiKeyRef?: string };
    if (!data.apiKeyRef?.trim()) {
      throw new Error(locale === 'zh-CN' ? '保存密钥失败。' : 'Failed to store secret.');
    }
    return data.apiKeyRef;
  }, [request, locale]);

  const loadProviderSecret = useCallback(async (
    providerId: string,
  ): Promise<string | null> => {
    const response = await request({ type: 'secrets/get', providerId });
    if (!response.success) {
      throw new Error(response.error);
    }
    const data = response.data as { secret?: string };
    return data.secret?.trim() ? data.secret : null;
  }, [request]);

  const saveWeb = useCallback(async (): Promise<void> => {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      web: draftToWeb(webDraft),
    };
    if (await saveConfig(next)) {
      setInfo(locale === 'zh-CN'
        ? '已保存 Web 工具设置；新会话将使用新的提供商密钥。'
        : 'Web tool settings saved. New sessions will use the updated provider keys.');
    }
  }, [config, webDraft, saveConfig, locale]);

  const contextValue = useMemo<SettingsContextValue>(() => ({
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
    hostStatus,
    activeSessionId,
    onOpenSubagentSession,
    selectSection: setSettingsNav,
    requestSkills,
    requestMcp,
    requestExtensions,
    requestPrompts,
    requestTheme,
    requestPet,
    requestAutomation,
    requestSubAgent,
    onThemeApplied,
    onPetActiveChanged,
    discoverProviderModels,
    testProviderModel,
    storeProviderSecret,
    loadProviderSecret,
  }), [
    request,
    config,
    root,
    saving,
    saveConfig,
    webDraft,
    saveWeb,
    preferences,
    onPreferencesChange,
    projectPath,
    hostStatus,
    activeSessionId,
    onOpenSubagentSession,
    requestSkills,
    requestMcp,
    requestExtensions,
    requestPrompts,
    requestTheme,
    requestPet,
    requestAutomation,
    requestSubAgent,
    onThemeApplied,
    onPetActiveChanged,
    discoverProviderModels,
    testProviderModel,
    storeProviderSecret,
    loadProviderSecret,
  ]);

  return (
    <SettingsShell
      activeSection={settingsNav}
      onSelectSection={setSettingsNav}
      contextValue={contextValue}
      banners={
        <>
          {error ? <Notice tone="error" title={locale === 'zh-CN' ? '设置错误' : 'Settings error'}>{error}</Notice> : null}
          {info ? <Notice tone="info">{info}</Notice> : null}
        </>
      }
    />
  );
}
