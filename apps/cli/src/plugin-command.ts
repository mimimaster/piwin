import { PluginInstallSource, formatError } from '@piwin/contracts';
import { createSecretResolver, getPiwinRoot } from '@piwin/host-runtime';
import {
  DEFAULT_PLUGIN_REGISTRY_URL,
  fetchPluginRegistry,
  installPlugin,
  loadInstalledPlugins,
  removeInstalledPlugin,
} from '@piwin/marketplace';
import { loadMcpConfig, saveMcpConfig } from '@piwin/mcp';
import { installSkill } from '@piwin/skills';
import { resolve } from 'node:path';
import { readOption } from './cli-args.js';

/**
 * `piwin plugin` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandPlugin(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();

  if (sub === 'list') {
    const plugins = await loadInstalledPlugins(root);
    if (plugins.length === 0) {
      console.log('(no plugins installed)');
      return;
    }
    for (const plugin of plugins) {
      console.log(
        `${plugin.id}\tv${plugin.version}\t${plugin.name}\tskills:${plugin.skills.length}\tmcp:${plugin.mcpServerIds.length}`,
      );
    }
    return;
  }

  if (sub === 'install') {
    const localPath = readOption(argv, '--local');
    const gitUrl = readOption(argv, '--git');
    const registryId = readOption(argv, '--registry');
    const bundledId = readOption(argv, '--bundled');
    const secretArgs = argv.filter((a) => a.startsWith('--secret='));
    const secrets: Record<string, string> = {};
    for (const arg of secretArgs) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        const key = arg.slice('--secret='.length, eq);
        const value = arg.slice(eq + 1);
        if (key && value) {
          secrets[key] = value;
        }
      }
    }

    let source: PluginInstallSource;
    if (localPath) {
      source = { kind: 'local', path: resolve(localPath) };
    } else if (gitUrl) {
      source = { kind: 'git', url: gitUrl };
    } else if (bundledId) {
      source = { kind: 'bundled', bundledId };
    } else if (registryId) {
      source = { kind: 'registry', registryId };
    } else {
      console.error(
        'plugin install requires --local <dir>, --git <url>, --registry <id>, or --bundled <id>',
      );
      process.exitCode = 1;
      return;
    }

    const secretResolver = createSecretResolver();
    try {
      const result = await installPlugin({
        piwinRoot: root,
        source,
        installSkill,
        ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
        writeSecret: async (ref, value) => {
          await secretResolver.writeSecretByRef(ref, value);
        },
        mergeMcpServer: async (serverId, config) => {
          const doc = await loadMcpConfig(root);
          doc.mcpServers[serverId] = config;
          await saveMcpConfig(root, doc);
        },
        ...(registryId
          ? {
              resolveRegistrySource: async (id: string) => {
                const index = await fetchPluginRegistry(DEFAULT_PLUGIN_REGISTRY_URL);
                const entry = index.plugins.find((p) => p.id === id);
                if (!entry) {
                  throw new Error(`Plugin "${id}" not found in registry`);
                }
                return entry.source;
              },
            }
          : {}),
      });
      console.log(
        `installed ${result.pluginId}: ${result.installedSkills.length} skills, ${result.mcpServerIds.length} MCP servers, ${result.secretRefs.length} secrets`,
      );
    } catch (error) {
      const message = formatError(error);
      console.error(`plugin install failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'uninstall') {
    const pluginId = argv[2];
    if (!pluginId) {
      console.error('plugin uninstall requires a plugin id');
      process.exitCode = 1;
      return;
    }
    try {
      const removed = await removeInstalledPlugin(root, pluginId);
      if (!removed) {
        console.error(`Plugin "${pluginId}" is not installed`);
        process.exitCode = 1;
        return;
      }
      // Remove owned skills.
      for (const skillId of removed.skills) {
        const skillPath = resolve(root, 'skills', skillId);
        await import('node:fs/promises').then((fs) =>
          fs.rm(skillPath, { recursive: true, force: true }).catch(() => undefined),
        );
      }
      // Remove owned MCP servers.
      if (removed.mcpServerIds.length > 0) {
        const doc = await loadMcpConfig(root);
        for (const serverId of removed.mcpServerIds) {
          delete doc.mcpServers[serverId];
        }
        await saveMcpConfig(root, doc);
      }
      console.log(`uninstalled ${removed.id}`);
    } catch (error) {
      const message = formatError(error);
      console.error(`plugin uninstall failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'registry') {
    const url = readOption(argv, '--url') ?? DEFAULT_PLUGIN_REGISTRY_URL;
    try {
      const index = await fetchPluginRegistry(url);
      if (index.plugins.length === 0) {
        console.log('(registry is empty)');
        return;
      }
      for (const entry of index.plugins) {
        console.log(`${entry.id}\tv${entry.version}\t${entry.name}\t${entry.source.kind}`);
      }
    } catch (error) {
      const message = formatError(error);
      console.error(`registry fetch failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Unknown plugin subcommand: ${sub}`);
  process.exitCode = 1;
}
