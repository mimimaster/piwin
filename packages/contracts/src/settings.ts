import type { AutomationConfig } from './automation.js';
import type { CodeSearchConfig } from './code-search.js';
import type { CompactionConfig, ProcessConfig, ThinkingConfig } from './config.js';
import type { DesktopRestoreConfig, ImageGenerationConfig, PiwinConfig } from './config.js';
import type { ExtensionsConfig } from './extensions.js';
import type { FlashcardsConfig } from './flashcards.js';
import type { MarketplaceConfig } from './marketplace-registry.js';
import type { ModelProviderConfig } from './config.js';
import type { NotesConfig } from './notes.js';
import type { PermissionConfig } from './permission.js';
import type { PromptsConfig } from './prompts.js';
import type { KnowledgeConfig } from './knowledge.js';
import type { RemoteConfig } from './remote.js';
import type {
  SessionConfig,
  SpeechConfig,
  SubagentConfig,
  ExecutionConfig,
  VideoGenerationConfig,
  VisionDelegationConfig,
} from './config.js';
import type { ReplyWriterConfig } from './reply-writer.js';
import type { SkillsConfig } from './skills.js';
import type { WalkthroughConfig } from './walkthrough.js';
import type { WebConfig } from './web.js';
import type { McpConfigDocument } from './mcp.js';

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
  | 'codeSearch'
  | 'skills'
  | 'extensions'
  | 'prompts'
  | 'compaction'
  | 'process'
  | 'session'
  | 'notes'
  | 'flashcards'
  | 'knowledge'
  | 'automation'
  | 'marketplace'
  | 'imageGeneration'
  | 'videoGeneration'
  | 'speech'
  | 'visionDelegation'
  | 'replyWriter'
  | 'permissions'
  | 'walkthrough'
  | 'subagents'
  | 'execution'
  | 'remote'
  | 'mcp';

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
  codeSearch: CodeSearchConfig | undefined;
  skills: SkillsConfig | undefined;
  extensions: ExtensionsConfig | undefined;
  prompts: PromptsConfig | undefined;
  compaction: CompactionConfig | undefined;
  process: ProcessConfig | undefined;
  session: SessionConfig | undefined;
  notes: NotesConfig | undefined;
  flashcards: FlashcardsConfig | undefined;
  knowledge: KnowledgeConfig | undefined;
  automation: AutomationConfig | undefined;
  marketplace: MarketplaceConfig | undefined;
  imageGeneration: ImageGenerationConfig | undefined;
  videoGeneration: VideoGenerationConfig | undefined;
  speech: SpeechConfig | undefined;
  visionDelegation: VisionDelegationConfig | undefined;
  replyWriter: ReplyWriterConfig | undefined;
  permissions: PermissionConfig | undefined;
  walkthrough: WalkthroughConfig | undefined;
  subagents: SubagentConfig | undefined;
  execution: ExecutionConfig | undefined;
  remote: RemoteConfig | undefined;
  mcp: McpConfigDocument | undefined;
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
  /** Revision of the complete persisted settings document (CAS token). */
  revision: string;
  /** Revision of settings that require a new Agent Runtime generation. */
  runtimeRevision: string;
  /** Per-domain hashes used to rebase non-overlapping applies. */
  domainRevisions: Partial<Record<SettingsDomain, string>>;
  config: PiwinConfig;
};

export type ApplySettingsInput = {
  /** Optional for transitional callers; new callers should always send it. */
  expectedRevision?: string;
  mutations: SettingsMutation[];
  /** Hash of each mutated domain as last read. Required to rebase a stale document revision. */
  expectedDomainRevisions?: Partial<Record<SettingsDomain, string>>;
};

/** Domains a remote shell may write through `settings/apply`. */
export const REMOTE_SETTINGS_APPLY_DOMAINS = [
  'hostMode',
  'agentMock',
  'providers',
  'defaultProviderId',
  'defaultModelId',
  'thinking',
  'media',
  'artifact',
  'web',
  'codeSearch',
  'skills',
  'extensions',
  'prompts',
  'compaction',
  'process',
  'session',
  'notes',
  'flashcards',
  'knowledge',
  'automation',
  'marketplace',
  'imageGeneration',
  'videoGeneration',
  'speech',
  'visionDelegation',
  'replyWriter',
  'permissions',
  'walkthrough',
  'subagents',
  'execution',
  'remote',
  'mcp',
  'desktop',
] as const satisfies readonly SettingsDomain[];

export type RemoteSettingsApplyDomain = (typeof REMOTE_SETTINGS_APPLY_DOMAINS)[number];

/** Window layout lives in the shell. `desktop` restore (model, last session) is Host-shared. */
export const DEVICE_LOCAL_SETTINGS_DOMAINS = [] as const satisfies readonly SettingsDomain[];

/**
 * Remote settings projection for `apiKeyRef` / `apiKeyEnv`. The shell can show
 * that Host already has a key without learning the ref. Apply must keep the
 * real Host value when this placeholder comes back.
 */
export const REDACTED_STORED_SECRET = '[stored-secret]';

export function isRedactedStoredSecret(value: unknown): boolean {
  return value === REDACTED_STORED_SECRET;
}

export function isRemoteSettingsApplyDomain(domain: SettingsDomain): boolean {
  return (REMOTE_SETTINGS_APPLY_DOMAINS as readonly SettingsDomain[]).includes(domain);
}

export function partitionRemoteSettingsMutations(mutations: SettingsMutation[]): {
  allowed: SettingsMutation[];
  blocked: SettingsMutation[];
} {
  const allowed: SettingsMutation[] = [];
  const blocked: SettingsMutation[] = [];
  for (const mutation of mutations) {
    if (isRemoteSettingsApplyDomain(mutation.domain)) {
      allowed.push(mutation);
    } else {
      blocked.push(mutation);
    }
  }
  return { allowed, blocked };
}

export type SettingsApplyTiming =
  | 'immediate'
  | 'next-message'
  | 'new-subagent'
  | 'new-runtime'
  | 'service-restart'
  | 'host-restart';

/**
 * A capability whose future admission must be re-evaluated immediately while
 * an older runtime generation is draining. This is deliberately narrower than
 * a SettingsDomain: changing a Web source, for example, does not revoke the
 * Web search capability when the replacement source remains available.
 */
export type ImmediateCapabilityRestriction =
  | 'web-search'
  | 'web-fetch'
  | 'browser-network'
  | 'process'
  | 'notes-write'
  | 'flashcards-write'
  | 'delegate'
  | 'permission-policy';

export type SettingsDomainImpact = {
  domain: SettingsDomain;
  timing: SettingsApplyTiming;
  /** True when the domain must be compiled into a replacement generation. */
  runtimeSchemaChanged: boolean;
  /** Exact capabilities narrowed before the replacement generation is live. */
  immediateRestrictions: ImmediateCapabilityRestriction[];
  /** @deprecated Derive from `immediateRestrictions.length > 0`. */
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
    // MCP is a separate on-disk document (`mcp.json`) managed by the
    // `mcp/save` command; it never flows through the PiwinConfig document.
    // Runtime invalidation for MCP changes is triggered by `mcp/save` via the
    // `mcp` SettingsDomain (repair spec WP4).
    if (domain === 'mcp') {
      continue;
    }
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

export const SETTINGS_DOMAINS = [
  'hostMode',
  'agentMock',
  'providers',
  'defaultProviderId',
  'defaultModelId',
  'thinking',
  'desktop',
  'media',
  'artifact',
  'web',
  'codeSearch',
  'skills',
  'extensions',
  'prompts',
  'compaction',
  'process',
  'session',
  'notes',
  'flashcards',
  'knowledge',
  'automation',
  'marketplace',
  'imageGeneration',
  'videoGeneration',
  'speech',
  'visionDelegation',
  'replyWriter',
  'permissions',
  'walkthrough',
  'subagents',
  'execution',
  'remote',
  'mcp',
] as const satisfies readonly SettingsDomain[];

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
  codeSearch: true,
  skills: true,
  extensions: true,
  prompts: true,
  compaction: true,
  process: true,
  session: true,
  notes: true,
  flashcards: true,
  knowledge: true,
  automation: true,
  marketplace: true,
  imageGeneration: true,
  videoGeneration: true,
  speech: true,
  visionDelegation: true,
  replyWriter: true,
  permissions: true,
  walkthrough: true,
  subagents: true,
  execution: true,
  remote: true,
  mcp: true,
};
