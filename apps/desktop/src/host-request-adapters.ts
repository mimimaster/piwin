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
} from '@piwin/contracts';
import type { HostClient } from './host-client';

export type HostRequestAdapters = {
  requestSubAgent: (command: Parameters<HostClient['request']>[0]) => Promise<HostResponse>;
  requestConfig: (command: {
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
    type: 'pet/list' | 'pet/get-active' | 'pet/set-active' | 'pet/install-local';
    petId?: string;
    sourcePath?: string;
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

export function createHostRequestAdapters(hostClient: HostClient): HostRequestAdapters {
  return {
    requestSubAgent: (command) => hostClient.request(command),
    requestConfig: async (command) => {
      if (command.type === 'config/get') {
        return hostClient.request({ type: 'config/get' });
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
      return hostClient.request({ type: 'config/set', config: command.config! });
    },
    requestSkills: async (command) => {
      if (command.type === 'config/get') {
        return hostClient.request({ type: 'config/get' });
      }
      if (command.type === 'config/set') {
        return hostClient.request({ type: 'config/set', config: command.config! });
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
      if (command.type === 'config/get') return hostClient.request({ type: 'config/get' });
      if (command.type === 'config/set') {
        return hostClient.request({ type: 'config/set', config: command.config! });
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
