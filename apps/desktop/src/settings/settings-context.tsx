/**
 * Settings context: carries the host request adapters and shared settings
 * state that used to be drilled prop-by-prop into every section branch of
 * SettingsPanel. Section pages read everything through useSettings().
 */
import { createContext, useContext, type PropsWithChildren, type ReactElement } from 'react';
import type {
  HostResponse,
  HostServerMessage,
  HostStatusData,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
  SessionSummary,
  ThemeManifest,
  SubagentBatchProjection,
} from '@piwin/contracts';
import type { SkillsPanelProps } from '../SkillsPanel';
import type { McpPanelProps } from '../McpPanel';
import type { ExtensionsPanelProps } from '../ExtensionsPanel';
import type { PluginsPanelProps } from '../PluginsPanel';
import type { PromptsPanelProps } from '../PromptsPanel';
import type { PetPanelProps } from '../PetPanel';
import type { AutomationPanelProps } from '../AutomationPanel';
import type { SubAgentPanelProps } from '../SubAgentPanel';
import type { DesktopPreferences } from '../ui-preferences';
import type { SettingsSectionId } from './section-registry';
import type { DraftWeb } from './web-draft';

/** Config-scope host request surface (config, models, secrets, permissions, usage). */
export type SettingsConfigRequest = (command: {
  type:
    | 'config/get'
    | 'config/set'
    | 'models/discover'
    | 'models/catalog/search'
    | 'models/image-catalog/search'
    | 'models/test'
    | 'vision/delegate'
    | 'vision/cache/clear'
    | 'secrets/set'
    | 'secrets/get'
    | 'web/test-search-source'
    | 'project/permissions-list'
    | 'project/permissions-revoke'
    | 'usage/get-rollup'
    | 'session/runtime-status'
    | 'session/compact-export'
    | 'host/runtime-resources'
    | 'theme/list'
    | 'theme/set-active';
  config?: PiwinConfig;
  provider?: ModelProviderConfig;
  apiKey?: string;
  modelId?: string;
  providerId?: string;
  secret?: string;
  path?: string;
  key?: string;
  scope?: import('@piwin/contracts').SessionScope;
  projectPath?: string;
  window?: { from?: string; to?: string };
  topSessions?: number;
  sessionId?: string;
  customInstructions?: string;
  outputPath?: string;
  themeId?: string;
  input?:
    | import('@piwin/contracts').ModelCatalogSearchRequest
    | import('@piwin/contracts').VisionDelegateInput;
  webTest?: import('@piwin/contracts').WebSearchTestInput;
}) => Promise<HostResponse>;

export type SettingsContextValue = {
  request: SettingsConfigRequest;
  /** Optional push source for live host-owned runtime status updates. */
  hostClient?: {
    subscribe: (listener: (message: HostServerMessage) => void) => () => void;
  };
  config: PiwinConfig | null;
  root: string;
  saving: boolean;
  setError: (message: string | null) => void;
  setInfo: (message: string | null, tone?: 'info' | 'success' | 'warning') => void;
  /** Persist config through the host; returns false (and sets error) on failure. */
  saveConfig: (next: PiwinConfig) => Promise<boolean>;
  /** Web tools draft lives above the section so it survives nav switches. */
  webDraft: DraftWeb;
  setWebDraft: (draft: DraftWeb) => void;
  saveWeb: (draftOverride?: DraftWeb) => Promise<boolean>;
  preferences: DesktopPreferences;
  onPreferencesChange: (prefs: DesktopPreferences) => void;
  projectPath: string | null;
  /** Whether the open project is trusted (ADR 0019 §2 — gates project allow rules + bypass). */
  projectTrusted: boolean;
  hostStatus: HostStatusData | null;
  activeSessionId: string | null;
  onOpenSubagentSession: ((sessionId: string) => void) | undefined;
  /** In-settings navigation (e.g. General → "Open Models settings…"). */
  selectSection: (section: SettingsSectionId) => void;
  requestSkills: SkillsPanelProps['request'];
  requestMcp: McpPanelProps['request'];
  requestExtensions: ExtensionsPanelProps['request'];
  requestPlugins: PluginsPanelProps['request'];
  requestPrompts: PromptsPanelProps['request'];
  requestPet: PetPanelProps['request'];
  requestAutomation: AutomationPanelProps['request'];
  requestSubAgent: SubAgentPanelProps['request'] | undefined;
  activeTheme: ThemeManifest;
  /** Live child summaries from host pushes (keyed by childSessionId). */
  subagentChildren?: Record<string, SessionSummary>;
  /** Live batch projections keyed by batch Run id. */
  subagentBatches?: Record<string, SubagentBatchProjection>;
  onThemeApplied: (theme: ThemeManifest) => void;
  onPetActiveChanged: PetPanelProps['onActiveChanged'];
  discoverProviderModels: (
    provider: ModelProviderConfig,
    options?: { apiKey?: string },
  ) => Promise<ModelDiscoveryResult>;
  testProviderModel: (
    provider: ModelProviderConfig,
    modelId: string,
    options?: { apiKey?: string },
  ) => Promise<{ durationMs: number }>;
  searchModelCatalog: (
    input?: import('@piwin/contracts').ModelCatalogSearchRequest,
  ) => Promise<import('@piwin/contracts').ModelCatalogSearchResult>;
  searchImageModelCatalog: () => Promise<import('@piwin/contracts').ImageModelCatalogSearchResult>;
  storeProviderSecret: (providerId: string, secret: string) => Promise<string>;
  loadProviderSecret: (providerId: string) => Promise<string | null>;
  testWebSearchSource?: (
    input: import('@piwin/contracts').WebSearchTestInput,
  ) => Promise<import('@piwin/contracts').WebSearchTestResult>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export type SettingsProviderProps = PropsWithChildren<{
  value: SettingsContextValue;
}>;

export function SettingsProvider(props: SettingsProviderProps): ReactElement {
  return <SettingsContext.Provider value={props.value}>{props.children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error(
      'useSettings() must be called inside <SettingsProvider>. ' +
        'Settings section components can only render within the settings shell.',
    );
  }
  return value;
}
