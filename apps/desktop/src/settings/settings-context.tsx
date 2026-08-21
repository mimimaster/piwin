/**
 * Settings context: carries the host request adapters and shared settings
 * state that used to be drilled prop-by-prop into every section branch of
 * SettingsPanel. Section pages read everything through useSettings().
 */
import { createContext, useContext, type PropsWithChildren, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  HostStatusData,
  LocalMobileAccessCommand,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
  SessionSummary,
  ThemeManifest,
  SubagentBatchProjection,
  SearchRoutePreviewInput,
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
    | 'models/image-test'
    | 'models/configured'
    | 'vision/delegate'
    | 'vision/cache/clear'
    | 'secrets/set'
    | 'secrets/get'
    | 'web/test-search-source'
    | 'web/search-route-preview'
    | 'project/permissions-list'
    | 'project/permissions-revoke'
    | 'usage/get-rollup'
    | 'session/runtime-status'
    | 'session/reload-runtime'
    | 'session/compact-export'
    | 'session/lifecycle-plan'
    | 'session/lifecycle-apply'
    | 'session/list'
    | 'session/unarchive'
    | 'session/delete'
    | 'session/cold-storage-status'
    | 'session/cold-storage-plan'
    | 'session/cold-storage-execute'
    | 'session/cold-storage-restore'
    | 'session/cold-storage-import'
    | 'session/cold-storage-reconcile'
    | 'session/pack-list'
    | 'host/runtime-resources'
    | 'theme/list'
    | 'theme/set-active';
  config?: PiwinConfig;
  provider?: ModelProviderConfig;
  apiKey?: string;
  modelId?: string;
  prompt?: string;
  providerId?: string;
  secret?: string;
  path?: string;
  key?: string;
  scope?: import('@piwin/contracts').SessionScope;
  projectPath?: string;
  allScopes?: boolean;
  includeArchived?: boolean;
  order?: import('@piwin/contracts').SessionListOrder;
  maxItems?: number;
  force?: boolean;
  window?: { from?: string; to?: string };
  topSessions?: number;
  sessionId?: string;
  expectedSettingsRevision?: string;
  when?: 'now' | 'after-current-run';
  sessionIds?: string[];
  confirmationDigest?: string;
  packPath?: string;
  directory?: string;
  customInstructions?: string;
  outputPath?: string;
  themeId?: string;
  planId?: string;
  input?:
    | import('@piwin/contracts').ModelCatalogSearchRequest
    | import('@piwin/contracts').VisionDelegateInput
    | SearchRoutePreviewInput;
  webTest?: import('@piwin/contracts').WebSearchTestInput;
}) => Promise<HostResponse>;

export type SettingsContextValue = {
  request: SettingsConfigRequest;
  /** Optional live sidecar client. Phone access uses request, never a remote Host. */
  hostClient?: {
    subscribe: (listener: (message: HostServerMessage) => void) => () => void;
    request?: (command: HostCommand | LocalMobileAccessCommand) => Promise<HostResponse>;
    getTransport?: () => 'mock' | 'live' | 'remote';
    supportsCommand?: (type: HostCommand['type']) => boolean;
  };
  config: PiwinConfig | null;
  root: string;
  saving: boolean;
  /** True when the attached Host does not advertise `settings/apply`. */
  remoteSettingsReadOnly?: boolean;
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
  testImageGenerationModel?: (
    provider: ModelProviderConfig,
    modelId: string,
    options?: { apiKey?: string; prompt?: string },
  ) => Promise<import('@piwin/contracts').ImageGenerationTestResult>;
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

/** Local/legacy Hosts are permissive; negotiated remote ceilings are authoritative when present. */
export function settingsHostSupportsCommand(
  settings: Pick<SettingsContextValue, 'hostClient'>,
  type: HostCommand['type'],
): boolean {
  return settings.hostClient?.supportsCommand?.(type) ?? true;
}

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
