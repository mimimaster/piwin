import {
  createDefaultArtifactConfig,
  createDefaultAutomationConfig,
  createDefaultCompactionConfig,
  createDefaultExtensionsConfig,
  createDefaultMarketplaceConfig,
  createDefaultPermissionConfig,
  createDefaultProcessConfig,
  createDefaultPromptsConfig,
  createDefaultSkillsConfig,
  createDefaultSubagentConfig,
  createDefaultWalkthroughConfig,
  createDefaultWebConfig,
  DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES,
  type HostResponse,
  type PiwinConfig,
  type SettingsMutation,
  type WebConfig,
  buildSettingsDomainMutations,
} from '@piwin/contracts';
/** Renderable Settings document when the remote Host cannot (or will not) send a full snapshot. */
export function createSettingsViewConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: [...DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES],
    },
    artifact: createDefaultArtifactConfig(),
    web: createDefaultWebConfig(),
    skills: createDefaultSkillsConfig(),
    extensions: createDefaultExtensionsConfig(),
    prompts: createDefaultPromptsConfig(),
    compaction: createDefaultCompactionConfig(),
    process: createDefaultProcessConfig(),
    automation: createDefaultAutomationConfig(),
    marketplace: createDefaultMarketplaceConfig(),
    walkthrough: createDefaultWalkthroughConfig(),
    subagents: createDefaultSubagentConfig(),
    permissions: createDefaultPermissionConfig(),
  };
}

export function mergeSettingsViewConfig(partial: unknown): PiwinConfig {
  const fallback = createSettingsViewConfig();
  const record = asRecord(partial);
  if (record === undefined) {
    return fallback;
  }
  const providers = Array.isArray(record.providers) ? record.providers : fallback.providers;
  const mediaRecord = asRecord(record.media);
  const artifactRecord = asRecord(record.artifact);
  const webRecord = asRecord(record.web);
  const allowedMimeTypes = Array.isArray(mediaRecord?.allowedMimeTypes)
    ? mediaRecord.allowedMimeTypes.filter((item): item is string => typeof item === 'string')
    : fallback.media.allowedMimeTypes;
  const result: PiwinConfig = {
    ...fallback,
    hostMode: record.hostMode === 'rpc' ? 'rpc' : 'sdk',
    providers: providers as PiwinConfig['providers'],
    media: {
      maxPasteBytes:
        typeof mediaRecord?.maxPasteBytes === 'number'
          ? mediaRecord.maxPasteBytes
          : fallback.media.maxPasteBytes,
      allowedMimeTypes,
    },
    artifact:
      artifactRecord === undefined
        ? fallback.artifact
        : ({ ...fallback.artifact, ...(artifactRecord as Record<string, unknown>) } as PiwinConfig['artifact']),
    web:
      webRecord === undefined
        ? (fallback.web as WebConfig)
        : ({ ...(fallback.web as WebConfig), ...(webRecord as Record<string, unknown>) } as WebConfig),
  };
  if (typeof record.defaultProviderId === 'string') {
    result.defaultProviderId = record.defaultProviderId;
  }
  if (typeof record.defaultModelId === 'string') {
    result.defaultModelId = record.defaultModelId;
  }
  if (record.thinking && typeof record.thinking === 'object') {
    result.thinking = record.thinking as NonNullable<PiwinConfig['thinking']>;
  }
  if (record.desktop && typeof record.desktop === 'object') {
    result.desktop = record.desktop as NonNullable<PiwinConfig['desktop']>;
  }
  if (record.skills && typeof record.skills === 'object') {
    result.skills = record.skills as NonNullable<PiwinConfig['skills']>;
  }
  if (record.extensions && typeof record.extensions === 'object') {
    result.extensions = record.extensions as NonNullable<PiwinConfig['extensions']>;
  }
  if (record.prompts && typeof record.prompts === 'object') {
    result.prompts = record.prompts as NonNullable<PiwinConfig['prompts']>;
  }
  if (record.compaction && typeof record.compaction === 'object') {
    result.compaction = record.compaction as NonNullable<PiwinConfig['compaction']>;
  }
  if (record.process && typeof record.process === 'object') {
    result.process = record.process as NonNullable<PiwinConfig['process']>;
  }
  if (record.session && typeof record.session === 'object') {
    result.session = record.session as NonNullable<PiwinConfig['session']>;
  }
  if (record.notes && typeof record.notes === 'object') {
    result.notes = record.notes as NonNullable<PiwinConfig['notes']>;
  }
  if (record.flashcards && typeof record.flashcards === 'object') {
    result.flashcards = record.flashcards as NonNullable<PiwinConfig['flashcards']>;
  }
  if (record.knowledge && typeof record.knowledge === 'object') {
    result.knowledge = record.knowledge as NonNullable<PiwinConfig['knowledge']>;
  }
  if (record.automation && typeof record.automation === 'object') {
    result.automation = record.automation as NonNullable<PiwinConfig['automation']>;
  }
  if (record.marketplace && typeof record.marketplace === 'object') {
    result.marketplace = record.marketplace as NonNullable<PiwinConfig['marketplace']>;
  }
  if (record.imageGeneration && typeof record.imageGeneration === 'object') {
    result.imageGeneration = record.imageGeneration as NonNullable<PiwinConfig['imageGeneration']>;
  }
  if (record.videoGeneration && typeof record.videoGeneration === 'object') {
    result.videoGeneration = record.videoGeneration as NonNullable<PiwinConfig['videoGeneration']>;
  }
  if (record.speech && typeof record.speech === 'object') {
    result.speech = record.speech as NonNullable<PiwinConfig['speech']>;
  }
  if (record.visionDelegation && typeof record.visionDelegation === 'object') {
    result.visionDelegation = record.visionDelegation as NonNullable<
      PiwinConfig['visionDelegation']
    >;
  }
  if (record.replyWriter && typeof record.replyWriter === 'object') {
    result.replyWriter = record.replyWriter as NonNullable<PiwinConfig['replyWriter']>;
  }
  if (record.permissions && typeof record.permissions === 'object') {
    result.permissions = {
      ...fallback.permissions,
      ...(record.permissions as NonNullable<PiwinConfig['permissions']>),
    };
  }
  if (record.walkthrough && typeof record.walkthrough === 'object') {
    result.walkthrough = record.walkthrough as NonNullable<PiwinConfig['walkthrough']>;
  }
  if (record.subagents && typeof record.subagents === 'object') {
    result.subagents = {
      ...fallback.subagents,
      ...(record.subagents as NonNullable<PiwinConfig['subagents']>),
    };
  }
  if (record.remote && typeof record.remote === 'object') {
    result.remote = record.remote as NonNullable<PiwinConfig['remote']>;
  }
  return result;
}

export type SettingsLoadInterpretation =
  | { kind: 'ok'; config: PiwinConfig; root: string }
  | { kind: 'remote-readonly'; config: PiwinConfig; root: string }
  | { kind: 'error'; error: string };

export function interpretSettingsLoadResponse(input: {
  remote: boolean;
  canReadSettings: boolean;
  response?: HostResponse;
}): SettingsLoadInterpretation {
  if (input.remote && !input.canReadSettings) {
    return {
      kind: 'remote-readonly',
      config: createSettingsViewConfig(),
      root: 'Remote Host',
    };
  }
  const response = input.response;
  if (response === undefined) {
    return input.remote
      ? {
          kind: 'remote-readonly',
          config: createSettingsViewConfig(),
          root: 'Remote Host',
        }
      : { kind: 'error', error: 'settings/get returned no response' };
  }
  if (!response.success) {
    if (input.remote && !input.canReadSettings) {
      return {
        kind: 'remote-readonly',
        config: createSettingsViewConfig(),
        root: 'Remote Host',
      };
    }
    return { kind: 'error', error: response.error };
  }
  const data = asRecord(response.data);
  const config = mergeSettingsViewConfig(data?.config);
  const root =
    typeof data?.root === 'string' && data.root.trim().length > 0
      ? data.root
      : input.remote
        ? 'Remote Host'
        : '~/.piwin';
  return { kind: 'ok', config, root };
}

/** Host `settings/apply` returns a snapshot; legacy `config/set` returned `config`. */
export function configFromSettingsWriteResponse(
  response: HostResponse,
  fallback: PiwinConfig,
): PiwinConfig {
  if (!response.success) {
    return fallback;
  }
  const data = asRecord(response.data);
  const snapshot = asRecord(data?.snapshot);
  if (snapshot?.config !== undefined) {
    return mergeSettingsViewConfig(snapshot.config);
  }
  if (data?.config !== undefined) {
    return mergeSettingsViewConfig(data.config);
  }
  return fallback;
}

/**
 * Remote Hosts that predate `knowledge` may ACK a notes write and then drop
 * reranker / parser / LLM extras during normalize. Treat that as a failed save
 * so the form is not cleared as if it stuck.
 */
export function knowledgeWriteRetained(sent: PiwinConfig, stored: PiwinConfig): boolean {
  const sentKnowledge = sent.knowledge;
  const storedKnowledge = stored.knowledge;
  const sentExtras = sent.notes?.knowledgeExtras;
  const storedExtras = stored.notes?.knowledgeExtras;
  if (sentKnowledge?.reranker?.enabled === true) {
    if (
      storedKnowledge?.reranker?.enabled !== true &&
      storedExtras?.reranker?.enabled !== true
    ) {
      return false;
    }
  }
  if (sentExtras?.reranker?.enabled === true && sentKnowledge?.reranker?.enabled !== true) {
    if (storedExtras?.reranker?.enabled !== true && storedKnowledge?.reranker?.enabled !== true) {
      return false;
    }
  }
  if (sentKnowledge?.parser?.mineru?.enabled === true) {
    if (
      storedKnowledge?.parser?.mineru?.enabled !== true &&
      storedExtras?.parser?.mineru?.enabled !== true
    ) {
      return false;
    }
  }
  if (sentKnowledge?.extractionLlm?.modelRef || sentKnowledge?.flashcardLlm?.modelRef) {
    const storedExtraction =
      storedKnowledge?.extractionLlm?.modelRef ?? storedExtras?.extractionLlm?.modelRef;
    const storedFlashcard =
      storedKnowledge?.flashcardLlm?.modelRef ?? storedExtras?.flashcardLlm?.modelRef;
    if (sentKnowledge.extractionLlm?.modelRef && !storedExtraction) {
      return false;
    }
    if (sentKnowledge.flashcardLlm?.modelRef && !storedFlashcard) {
      return false;
    }
  }
  return true;
}

/**
 * Settings forms edit the merged view document. Diff against that view, not
 * the raw Host projection — omitted keys are filled with local defaults and
 * must not look like the user changed process/providers/desktop.
 */
export function settingsMutationsFromViewDraft(
  snapshotConfig: unknown,
  nextConfig: PiwinConfig,
): SettingsMutation[] {
  return buildSettingsDomainMutations(mergeSettingsViewConfig(snapshotConfig), nextConfig);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
