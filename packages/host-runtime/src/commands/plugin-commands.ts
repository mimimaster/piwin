/**
 * Host IPC handlers: plugins.
 *
 * Wires the marketplace plugin install pipeline to the host, injecting
 * real keychain writes (via secretResolver) and MCP config merges (via
 * @piwin/mcp load/save). Uninstall reverses an installation by removing
 * owned skills, MCP server ids, and keychain refs.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostCommand, HostResponse, McpServerConfig } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import { pluginSecretRef } from '@piwin/contracts';
import {
  DEFAULT_PLUGIN_REGISTRY_URL,
  fetchPluginRegistry,
  findInstalledPlugin,
  installPlugin,
  loadInstalledPlugins,
  removeInstalledPlugin,
} from '@piwin/marketplace';
import { loadMcpConfig, saveMcpConfig } from '@piwin/mcp';
import { installSkill } from '@piwin/skills';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot } from '../paths.js';
import { createSecretResolver } from '../secret-resolver.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'plugins/install',
  'plugins/list',
  'plugins/uninstall',
  'plugins/registry/list',
  'plugins/secrets/collect',
]);

export function isPluginCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handlePluginCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'plugins/install': {
      try {
        const rootDir = getPiwinRoot(context.piwinRoot);
        const secretResolver = createSecretResolver();
        const result = await installPlugin({
          piwinRoot: rootDir,
          source: command.source,
          installSkill,
          ...(command.secrets ? { secrets: command.secrets } : {}),
          writeSecret: async (ref, value) => {
            await secretResolver.writeSecretByRef(ref, value);
          },
          mergeMcpServer: async (serverId, config) => {
            const doc = await loadMcpConfig(rootDir);
            doc.mcpServers[serverId] = config;
            await saveMcpConfig(rootDir, doc);
          },
        });
        return ok(requestId, 'plugins/install', result);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'plugins/install', message);
      }
    }

    case 'plugins/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const plugins = await loadInstalledPlugins(rootDir);
      return ok(requestId, 'plugins/list', { plugins });
    }

    case 'plugins/uninstall': {
      try {
        const rootDir = getPiwinRoot(context.piwinRoot);
        const removed = await removeInstalledPlugin(rootDir, command.pluginId);
        if (!removed) {
          return fail(
            requestId,
            'plugins/uninstall',
            `Plugin "${command.pluginId}" is not installed`,
          );
        }

        // Remove owned skills.
        for (const skillId of removed.skills) {
          const skillPath = join(rootDir, 'skills', skillId);
          await rm(skillPath, { recursive: true, force: true }).catch(() => undefined);
        }

        // Remove owned MCP server ids from mcp.json.
        if (removed.mcpServerIds.length > 0) {
          const doc = await loadMcpConfig(rootDir);
          for (const serverId of removed.mcpServerIds) {
            delete doc.mcpServers[serverId];
          }
          await saveMcpConfig(rootDir, doc);
        }

        // Remove keychain refs (best-effort).
        const secretResolver = createSecretResolver();
        for (const secretName of removed.secrets) {
          const ref = pluginSecretRef(removed.id, secretName);
          await deletePluginSecret(ref).catch(() => undefined);
        }

        return ok(requestId, 'plugins/uninstall', { pluginId: removed.id, removed });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'plugins/uninstall', message);
      }
    }

    case 'plugins/registry/list': {
      try {
        const url = command.registryUrl ?? DEFAULT_PLUGIN_REGISTRY_URL;
        const index = await fetchPluginRegistry(url);
        return ok(requestId, 'plugins/registry/list', { index });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'plugins/registry/list', message);
      }
    }

    case 'plugins/secrets/collect': {
      try {
        const rootDir = getPiwinRoot(context.piwinRoot);
        const plugin = await findInstalledPlugin(rootDir, command.pluginId);
        if (!plugin) {
          return fail(
            requestId,
            'plugins/secrets/collect',
            `Plugin "${command.pluginId}" is not installed`,
          );
        }
        const refs: string[] = [];
        const secretResolver = createSecretResolver();
        for (const [name, value] of Object.entries(command.secrets)) {
          const ref = pluginSecretRef(plugin.id, name);
          await secretResolver.writeSecretByRef(ref, value);
          refs.push(name);
        }
        return ok(requestId, 'plugins/secrets/collect', { pluginId: plugin.id, secretRefs: refs });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'plugins/secrets/collect', message);
      }
    }

    default:
      return null;
  }
}

/** Delete a keychain entry (best-effort). */
async function deletePluginSecret(ref: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('security', ['delete-generic-password', '-s', ref]);
  } catch {
    // best-effort; entry may not exist
  }
}
