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
  if (record.subagents && typeof record.subagents === 'object') {
    result.subagents = {
      ...fallback.subagents,
      ...(record.subagents as NonNullable<PiwinConfig['subagents']>),
    };
  }
  if (record.permissions && typeof record.permissions === 'object') {
    result.permissions = {
      ...fallback.permissions,
      ...(record.permissions as NonNullable<PiwinConfig['permissions']>),
    };
  }
  if (record.visionDelegation && typeof record.visionDelegation === 'object') {
    result.visionDelegation = record.visionDelegation as NonNullable<
      PiwinConfig['visionDelegation']
    >;
  }
  if (record.replyWriter && typeof record.replyWriter === 'object') {
    result.replyWriter = record.replyWriter as NonNullable<PiwinConfig['replyWriter']>;
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
