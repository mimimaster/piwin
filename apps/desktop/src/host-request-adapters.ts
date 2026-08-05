/**
 * Panel-facing HostCommand adapters. Thin wrappers over HostClient.request.
 * Keeps App free of per-panel switchboards.
 */
import { useMemo } from 'react';
import type {
  HostResponse,
  InstallSource,
  McpServerConfig,
  ModelProviderConfig,
  PiwinConfig,
  PluginInstallSource,
} from '@piwin/contracts';
import { buildSettingsDomainMutations } from '@piwin/contracts';
import type { HostClient } from './host-client';

export type HostRequestAdapters = {
  requestSubAgent: (command: Parameters<HostClient['request']>[0]) => Promise<HostResponse>;
  requestConfig: (command: {
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
      | 'session/runtime-status';
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
    input?:
      | import('@piwin/contracts').ModelCatalogSearchRequest
      | import('@piwin/contracts').VisionDelegateInput;
    webTest?: import('@piwin/contracts').WebSearchTestInput;
  }) => Promise<HostResponse>;
  requestSkills: (command: {
    type:
      | 'skills/list'
      | 'skills/set_enabled'
      | 'skills/install'
      | 'skills/store-list'
      | 'config/get'
      | 'config/set';
    projectPath?: string;
    skillId?: string;
    enabled?: boolean;
    source?: InstallSource;
    name?: string;
    config?: PiwinConfig;
  }) => Promise<HostResponse>;
  requestExtensions: (command: {
    type:
      | 'extensions/list'
      | 'extensions/set_enabled'
      | 'extensions/ensure-bundled'
      | 'extensions/install';
    projectPath?: string;
    extensionId?: string;
    enabled?: boolean;
    source?: InstallSource;
    name?: string;
  }) => Promise<HostResponse>;
  requestPlugins: (command: {
    type:
      | 'plugins/list'
      | 'plugins/install'
      | 'plugins/uninstall'
      | 'plugins/registry/list'
      | 'plugins/secrets/collect';
    source?: PluginInstallSource;
    pluginId?: string;
    secrets?: Record<string, string>;
    registryUrl?: string;
  }) => Promise<HostResponse>;
  requestPrompts: (command: {
    type: 'prompts/list' | 'prompts/set_enabled';
    projectPath?: string;
    promptId?: string;
    enabled?: boolean;
  }) => Promise<HostResponse>;
  requestMcp: (command: {
    type:
      | 'mcp/get'
      | 'mcp/validate'
      | 'mcp/save'
      | 'mcp/list_tools'
      | 'mcp/status'
      | 'mcp/start'
      | 'mcp/stop'
      | 'mcp/registry-list'
      | 'mcp/registry-install-draft';
    document?: unknown;
    serverId?: string;
    query?: string;
    draft?: McpServerConfig;
  }) => Promise<HostResponse>;
  requestGit: (command: Parameters<HostClient['request']>[0]) => Promise<HostResponse>;
  requestTheme: (command: {
    type: 'theme/list' | 'theme/get-active' | 'theme/set-active' | 'theme/install-local';
    themeId?: string;
    sourcePath?: string;
  }) => Promise<HostResponse>;
  requestPet: (command: {
    type:
      | 'pet/list'
      | 'pet/get-active'
      | 'pet/set-active'
      | 'pet/install-local'
      | 'pet/store-query'
      | 'pet/install-registry'
      | 'pet/cancel';
    petId?: string;
    sourcePath?: string;
    /** PetStoreQuery payload for pet/store-query. */
    query?: { query: string; source?: 'bundled' | 'local' | 'codex-live' | 'registry' };
    /** JSON-encoded registry entry (or bare URL) for pet/install-registry. */
    url?: string;
    /** Request id to cancel for pet/cancel. */
    requestId?: string;
    /** Pre-generated request id for install-registry so it can be cancelled. */
    id?: string;
  }) => Promise<HostResponse>;
  requestPty: (command: {
    type: 'pty/open' | 'pty/write' | 'pty/resize' | 'pty/close' | 'pty/list';
    input?: { projectPath: string; cwd?: string; cols?: number; rows?: number };
    ptyId?: string;
    data?: string;
    cols?: number;
    rows?: number;
    projectPath?: string;
  }) => Promise<HostResponse>;
  requestAutomation: (command: {
    type:
      | 'config/get'
      | 'config/set'
      | 'cron/list'
      | 'cron/upsert'
      | 'cron/delete'
      | 'cron/run'
      | 'hooks/list'
      | 'hooks/set';
    config?: PiwinConfig;
    job?: import('@piwin/contracts').CronJob;
    jobId?: string;
    hooks?: import('@piwin/contracts').HookDefinition[];
  }) => Promise<HostResponse>;
};

async function getSettingsAsLegacyConfigView(hostClient: HostClient): Promise<HostResponse> {
  const response = await hostClient.request({ type: 'settings/get' });
  if (!response.success) {
    return response;
  }
  const data = response.data as {
    snapshot?: {
      config: PiwinConfig;
      revision: string;
      schemaVersion: number;
    };
    root?: string;
  };
  if (!data.snapshot) {
    return {
      ...response,
      success: false,
      error: 'settings/get returned no snapshot',
    };
  }
  return {
    ...response,
    data: {
      config: data.snapshot.config,
      root: data.root,
      revision: data.snapshot.revision,
      schemaVersion: data.snapshot.schemaVersion,
    },
  };
}

async function applyConfigDraft(
  hostClient: HostClient,
  nextConfig: PiwinConfig,
): Promise<HostResponse> {
  const currentResponse = await hostClient.request({ type: 'settings/get' });
  if (!currentResponse.success) {
    return currentResponse;
  }
  const data = currentResponse.data as {
    snapshot?: { config: PiwinConfig; revision: string };
  };
  if (!data.snapshot) {
    return {
      type: 'response',
      command: 'settings/apply',
      success: false,
      error: 'settings/get returned no snapshot',
    };
  }
  return hostClient.request({
    type: 'settings/apply',
    input: {
      expectedRevision: data.snapshot.revision,
      mutations: buildSettingsDomainMutations(data.snapshot.config, nextConfig),
    },
  });
}

export function createHostRequestAdapters(hostClient: HostClient): HostRequestAdapters {
  return {
    requestSubAgent: (command) => hostClient.request(command),
    requestConfig: async (command) => {
      if (command.type === 'config/get') {
        return getSettingsAsLegacyConfigView(hostClient);
      }
      if (command.type === 'project/permissions-list') {
        return hostClient.request({
          type: 'project/permissions-list',
          path: command.path ?? '',
        });
      }
      if (command.type === 'project/permissions-revoke') {
        return hostClient.request({
          type: 'project/permissions-revoke',
          path: command.path ?? '',
          key: command.key ?? '',
        });
      }
      if (command.type === 'models/discover') {
        if (!command.provider) {
          return {
            type: 'response',
            command: 'models/discover',
            success: false,
            error: 'provider is required',
          };
        }
        return hostClient.request({
          type: 'models/discover',
          provider: command.provider,
          ...(command.apiKey ? { apiKey: command.apiKey } : {}),
        });
      }
      if (command.type === 'models/test') {
        if (!command.provider || !command.modelId?.trim()) {
          return {
            type: 'response',
            command: 'models/test',
            success: false,
            error: 'provider and modelId are required',
          };
        }
        return hostClient.request({
          type: 'models/test',
          provider: command.provider,
          modelId: command.modelId,
          ...(command.apiKey ? { apiKey: command.apiKey } : {}),
        });
      }
      if (command.type === 'models/catalog/search') {
        return hostClient.request({
          type: 'models/catalog/search',
          ...(command.input
            ? { input: command.input as import('@piwin/contracts').ModelCatalogSearchRequest }
            : {}),
        });
      }
      if (command.type === 'vision/cache/clear') {
        return hostClient.request({ type: 'vision/cache/clear' });
      }
      if (command.type === 'vision/delegate') {
        if (!command.input || typeof command.input !== 'object') {
          return {
            type: 'response',
            command: 'vision/delegate',
            success: false,
            error: 'input is required',
          };
        }
        return hostClient.request({
          type: 'vision/delegate',
          input: command.input as import('@piwin/contracts').VisionDelegateInput,
        });
      }
      if (command.type === 'secrets/set') {
        return hostClient.request({
          type: 'secrets/set',
          providerId: command.providerId ?? '',
          secret: command.secret ?? '',
        });
      }
      if (command.type === 'secrets/get') {
        return hostClient.request({
          type: 'secrets/get',
          providerId: command.providerId ?? '',
        });
      }
      if (command.type === 'web/test-search-source') {
        if (!command.webTest) {
          return {
            type: 'response',
            command: 'web/test-search-source',
            success: false,
            error: 'web test input is required',
          };
        }
        return hostClient.request({
          type: 'web/test-search-source',
          input: command.webTest,
        });
      }
      if (command.type === 'usage/get-rollup') {
        const payload: {
          type: 'usage/get-rollup';
          topSessions?: number;
          window?: { from?: string; to?: string };
          projectPath?: string;
        } = {
          type: 'usage/get-rollup',
        };
        const projectPath =
          command.projectPath ??
          (command.scope && command.scope.kind === 'project'
            ? command.scope.projectPath
            : undefined);
        if (projectPath) payload.projectPath = projectPath;
        if (command.window) payload.window = command.window;
        if (command.topSessions !== undefined) payload.topSessions = command.topSessions;
        return hostClient.request(payload);
      }
      if (command.type === 'session/runtime-status') {
        return hostClient.request({
          type: 'session/runtime-status',
          sessionId: command.sessionId ?? '',
        });
      }
      if (!command.config) {
        return {
          type: 'response',
          command: 'settings/apply',
          success: false,
          error: 'config is required',
        };
      }
      return applyConfigDraft(hostClient, command.config);
    },
    requestSkills: async (command) => {
      if (command.type === 'config/get') {
        return getSettingsAsLegacyConfigView(hostClient);
      }
      if (command.type === 'config/set') {
        if (!command.config) {
          return {
            type: 'response',
            command: 'settings/apply',
            success: false,
            error: 'config is required',
          };
        }
        return applyConfigDraft(hostClient, command.config);
      }
      if (command.type === 'skills/list') {
        const payload: { type: 'skills/list'; projectPath?: string } = { type: 'skills/list' };
        if (command.projectPath) payload.projectPath = command.projectPath;
        return hostClient.request(payload);
      }
      if (command.type === 'skills/store-list') {
        return hostClient.request({ type: 'skills/store-list' });
      }
      if (command.type === 'skills/install') {
        if (!command.source) {
          return {
            type: 'response',
            command: 'skills/install',
            success: false,
            error: 'missing install source',
          };
        }
        const payload: {
          type: 'skills/install';
          source: InstallSource;
          name?: string;
        } = { type: 'skills/install', source: command.source };
        if (command.name) payload.name = command.name;
        return hostClient.request(payload);
      }
      return hostClient.request({
        type: 'skills/set_enabled',
        skillId: command.skillId ?? '',
        enabled: command.enabled === true,
      });
    },
    requestExtensions: async (command) => {
      if (command.type === 'extensions/list') {
        const payload: { type: 'extensions/list'; projectPath?: string } = {
          type: 'extensions/list',
        };
        if (command.projectPath) payload.projectPath = command.projectPath;
        return hostClient.request(payload);
      }
      if (command.type === 'extensions/ensure-bundled') {
        return hostClient.request({ type: 'extensions/ensure-bundled' });
      }
      if (command.type === 'extensions/install') {
        if (!command.source) {
          return {
            type: 'response',
            command: 'extensions/install',
            success: false,
            error: 'missing install source',
          };
        }
        const payload: {
          type: 'extensions/install';
          source: InstallSource;
          name?: string;
        } = { type: 'extensions/install', source: command.source };
        if (command.name) payload.name = command.name;
        return hostClient.request(payload);
      }
      return hostClient.request({
        type: 'extensions/set_enabled',
        extensionId: command.extensionId ?? '',
        enabled: command.enabled === true,
      });
    },
    requestPlugins: async (command) => {
      if (command.type === 'plugins/list') {
        return hostClient.request({ type: 'plugins/list' });
      }
      if (command.type === 'plugins/registry/list') {
        const payload: { type: 'plugins/registry/list'; registryUrl?: string } = {
          type: 'plugins/registry/list',
        };
        if (command.registryUrl) payload.registryUrl = command.registryUrl;
        return hostClient.request(payload);
      }
      if (command.type === 'plugins/secrets/collect') {
        return hostClient.request({
          type: 'plugins/secrets/collect',
          pluginId: command.pluginId ?? '',
          secrets: command.secrets ?? {},
        });
      }
      if (command.type === 'plugins/uninstall') {
        return hostClient.request({
          type: 'plugins/uninstall',
          pluginId: command.pluginId ?? '',
        });
      }
      if (!command.source) {
        return {
          type: 'response',
          command: 'plugins/install',
          success: false,
          error: 'missing install source',
        };
      }
      const payload: {
        type: 'plugins/install';
        source: PluginInstallSource;
        secrets?: Record<string, string>;
      } = { type: 'plugins/install', source: command.source };
      if (command.secrets) payload.secrets = command.secrets;
      return hostClient.request(payload);
    },
    requestPrompts: async (command) => {
      if (command.type === 'prompts/list') {
        const payload: { type: 'prompts/list'; projectPath?: string } = { type: 'prompts/list' };
        if (command.projectPath) payload.projectPath = command.projectPath;
        return hostClient.request(payload);
      }
      return hostClient.request({
        type: 'prompts/set_enabled',
        promptId: command.promptId ?? '',
        enabled: command.enabled === true,
      });
    },
    requestMcp: async (command) => {
      if (command.type === 'mcp/get') return hostClient.request({ type: 'mcp/get' });
      if (command.type === 'mcp/validate') {
        return hostClient.request({ type: 'mcp/validate', document: command.document });
      }
      if (command.type === 'mcp/save') {
        return hostClient.request({ type: 'mcp/save', document: command.document });
      }
      if (command.type === 'mcp/status') return hostClient.request({ type: 'mcp/status' });
      if (command.type === 'mcp/start') {
        return hostClient.request({ type: 'mcp/start', serverId: command.serverId ?? '' });
      }
      if (command.type === 'mcp/stop') {
        return hostClient.request({ type: 'mcp/stop', serverId: command.serverId ?? '' });
      }
      if (command.type === 'mcp/registry-list') {
        return hostClient.request({
          type: 'mcp/registry-list',
          ...(command.query ? { query: command.query } : {}),
        });
      }
      if (command.type === 'mcp/registry-install-draft') {
        return hostClient.request({
          type: 'mcp/registry-install-draft',
          serverId: command.serverId ?? 'server',
          draft: command.draft ?? { command: 'echo' },
        });
      }
      return hostClient.request({
        type: 'mcp/list_tools',
        serverId: command.serverId ?? '',
      });
    },
    requestGit: (command) => hostClient.request(command),
    requestTheme: async (command) => {
      if (command.type === 'theme/list') return hostClient.request({ type: 'theme/list' });
      if (command.type === 'theme/get-active') {
        return hostClient.request({ type: 'theme/get-active' });
      }
      if (command.type === 'theme/set-active') {
        return hostClient.request({ type: 'theme/set-active', themeId: command.themeId ?? '' });
      }
      return hostClient.request({
        type: 'theme/install-local',
        sourcePath: command.sourcePath ?? '',
      });
    },
    requestPet: async (command) => {
      if (command.type === 'pet/list') return hostClient.request({ type: 'pet/list' });
      if (command.type === 'pet/get-active') {
        return hostClient.request({ type: 'pet/get-active' });
      }
      if (command.type === 'pet/set-active') {
        return hostClient.request({ type: 'pet/set-active', petId: command.petId ?? '' });
      }
      if (command.type === 'pet/store-query') {
        return hostClient.request({
          type: 'pet/store-query',
          query: command.query ?? { query: '' },
        });
      }
      if (command.type === 'pet/install-registry') {
        const payload: {
          type: 'pet/install-registry';
          url: string;
          id?: string;
        } = { type: 'pet/install-registry', url: command.url ?? '' };
        if (command.id) payload.id = command.id;
        return hostClient.request(payload);
      }
      if (command.type === 'pet/cancel') {
        return hostClient.request({
          type: 'pet/cancel',
          requestId: command.requestId ?? '',
        });
      }
      return hostClient.request({
        type: 'pet/install-local',
        sourcePath: command.sourcePath ?? '',
      });
    },
    requestPty: async (command) => {
      if (command.type === 'pty/open') {
        return hostClient.request({ type: 'pty/open', input: command.input! });
      }
      if (command.type === 'pty/write') {
        return hostClient.request({
          type: 'pty/write',
          ptyId: command.ptyId ?? '',
          data: command.data ?? '',
        });
      }
      if (command.type === 'pty/resize') {
        return hostClient.request({
          type: 'pty/resize',
          ptyId: command.ptyId ?? '',
          cols: command.cols ?? 80,
          rows: command.rows ?? 24,
        });
      }
      if (command.type === 'pty/close') {
        return hostClient.request({ type: 'pty/close', ptyId: command.ptyId ?? '' });
      }
      return hostClient.request({
        type: 'pty/list',
        ...(command.projectPath ? { projectPath: command.projectPath } : {}),
      });
    },
    requestAutomation: async (command) => {
      if (command.type === 'config/get') return getSettingsAsLegacyConfigView(hostClient);
      if (command.type === 'config/set') {
        if (!command.config) {
          return {
            type: 'response',
            command: 'settings/apply',
            success: false,
            error: 'config is required',
          };
        }
        return applyConfigDraft(hostClient, command.config);
      }
      if (command.type === 'cron/list') return hostClient.request({ type: 'cron/list' });
      if (command.type === 'cron/upsert') {
        return hostClient.request({ type: 'cron/upsert', job: command.job! });
      }
      if (command.type === 'cron/delete') {
        return hostClient.request({ type: 'cron/delete', jobId: command.jobId ?? '' });
      }
      if (command.type === 'cron/run') {
        return hostClient.request({ type: 'cron/run', jobId: command.jobId ?? '' });
      }
      if (command.type === 'hooks/list') return hostClient.request({ type: 'hooks/list' });
      return hostClient.request({ type: 'hooks/set', hooks: command.hooks ?? [] });
    },
  };
}

/** Stable memoized adapters for React components. */
export function useHostRequestAdapters(hostClient: HostClient): HostRequestAdapters {
  return useMemo(() => createHostRequestAdapters(hostClient), [hostClient]);
}
