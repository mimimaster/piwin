import type { AutomationConfig } from './automation.js';
import type { CompactionConfig, ProcessConfig, ThinkingConfig } from './config.js';
import type { DesktopRestoreConfig, ImageGenerationConfig, PiwinConfig } from './config.js';
import type { ExtensionsConfig } from './extensions.js';
import type { FlashcardsConfig } from './flashcards.js';
import type { MarketplaceConfig } from './marketplace-registry.js';
import type { ModelProviderConfig } from './config.js';
import type { NotesConfig } from './notes.js';
import type { PermissionConfig } from './permission.js';
import type { PromptsConfig } from './prompts.js';
import type { RemoteConfig } from './remote.js';
import type { SessionConfig, SubagentConfig, VisionDelegationConfig } from './config.js';
import type { SkillsConfig } from './skills.js';
import type { WalkthroughConfig } from './walkthrough.js';
import type { WebConfig } from './web.js';

/** Persisted settings document version managed by SettingsService. */
export const PIWIN_SETTINGS_SCHEMA_VERSION = 2 as const;

export type SettingsDomain =
  | 'hostMode'
  | 'agentMock'
  | 'providers'
  | 'defaultProviderId'
  | 'defaultModelId'
  | 'thinking'
  | 'desktop'
  | 'media'
  | 'artifact'
  | 'web'
  | 'skills'
  | 'extensions'
  | 'prompts'
  | 'compaction'
  | 'process'
  | 'session'
  | 'notes'
  | 'flashcards'
  | 'automation'
  | 'marketplace'
  | 'imageGeneration'
  | 'visionDelegation'
  | 'permissions'
  | 'walkthrough'
  | 'subagents'
  | 'remote';

/** Type map used to make domain replacement mutations compile-time checked. */
export type SettingsDomainValueMap = {
  hostMode: PiwinConfig['hostMode'];
  agentMock: PiwinConfig['agentMock'] | undefined;
  providers: ModelProviderConfig[];
  defaultProviderId: string | undefined;
  defaultModelId: string | undefined;
  thinking: ThinkingConfig | undefined;
  desktop: DesktopRestoreConfig | undefined;
  media: PiwinConfig['media'];
  artifact: PiwinConfig['artifact'];
  web: WebConfig | undefined;
  skills: SkillsConfig | undefined;
  extensions: ExtensionsConfig | undefined;
  prompts: PromptsConfig | undefined;
  compaction: CompactionConfig | undefined;
  process: ProcessConfig | undefined;
  session: SessionConfig | undefined;
  notes: NotesConfig | undefined;
  flashcards: FlashcardsConfig | undefined;
  automation: AutomationConfig | undefined;
  marketplace: MarketplaceConfig | undefined;
  imageGeneration: ImageGenerationConfig | undefined;
  visionDelegation: VisionDelegationConfig | undefined;
  permissions: PermissionConfig | undefined;
  walkthrough: WalkthroughConfig | undefined;
  subagents: SubagentConfig | undefined;
  remote: RemoteConfig | undefined;
};

export type ReplaceSettingsDomainMutation = {
  [Domain in SettingsDomain]: {
    kind: 'replace-domain';
    domain: Domain;
    value: SettingsDomainValueMap[Domain];
  };
}[SettingsDomain];

export type SettingsMutation = ReplaceSettingsDomainMutation;

export type SettingsSnapshot = {
  schemaVersion: typeof PIWIN_SETTINGS_SCHEMA_VERSION;
  revision: string;
  config: PiwinConfig;
};

export type ApplySettingsInput = {
  /** Optional for transitional callers; new callers should always send it. */
  expectedRevision?: string;
  mutations: SettingsMutation[];
};

export type SettingsApplyTiming =
  | 'immediate'
  | 'next-message'
  | 'new-subagent'
  | 'new-runtime'
  | 'service-restart'
  | 'host-restart';

export type SettingsDomainImpact = {
  domain: SettingsDomain;
  timing: SettingsApplyTiming;
  securityTightenedImmediately: boolean;
};

export type SettingsApplyResult = {
  snapshot: SettingsSnapshot;
  changedDomains: SettingsDomainImpact[];
};

/**
 * Build typed domain mutations from two normalized config snapshots.
 * This keeps Desktop/CLI from sending a whole config document while allowing
 * existing forms to continue producing a complete local draft.
 */
export function buildSettingsDomainMutations(
  previous: PiwinConfig,
  next: PiwinConfig,
): SettingsMutation[] {
  const mutations: SettingsMutation[] = [];
  const domains = Object.keys(settingsDomainValueMap) as SettingsDomain[];
  for (const domain of domains) {
    const previousValue = previous[domain];
    const nextValue = next[domain];
    if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) {
      continue;
    }
    mutations.push({
      kind: 'replace-domain',
      domain,
      value: nextValue as SettingsDomainValueMap[typeof domain],
    } as SettingsMutation);
  }
  return mutations;
}

const settingsDomainValueMap: Record<SettingsDomain, true> = {
  hostMode: true,
  agentMock: true,
  providers: true,
  defaultProviderId: true,
  defaultModelId: true,
  thinking: true,
  desktop: true,
  media: true,
  artifact: true,
  web: true,
  skills: true,
  extensions: true,
  prompts: true,
  compaction: true,
  process: true,
  session: true,
  notes: true,
  flashcards: true,
  automation: true,
  marketplace: true,
  imageGeneration: true,
  visionDelegation: true,
  permissions: true,
  walkthrough: true,
  subagents: true,
  remote: true,
};
