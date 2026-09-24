/**
 * Plugin installation pipeline.
 *
 * Flow:
 *   1. Resolve source → local directory (local copy / git clone / registry resolve).
 *   2. Materialize into ~/.piwin/plugins/cache/<id>@<version>/.
 *   3. Parse plugin.json manifest.
 *   4. Install each skill via the injected installSkill port.
 *   5. Merge each MCP server (namespaced id) via injected mergeMcpServer callback.
 *   6. Write each collected secret via injected writeSecret callback.
 *   7. Persist InstalledPlugin record via plugin-store.
 *
 * MCP merge and keychain writes are injected so this module stays free of
 * @piwin/mcp and keychain dependencies — the host wires real implementations.
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  InstallSource,
  InstallPluginResult,
  McpServerConfig,
  PluginInstallSource,
} from '@piwin/contracts';
import {
  normalizeRepositorySubdir,
  pluginMcpServerId as namespacedId,
  pluginSecretRef as secretRef,
} from '@piwin/contracts';
import { parsePluginManifest } from './manifest.js';
import { resolveSecretArgs, resolveSecretEnv } from './secret-env.js';
import { findFeaturedPlugin } from './featured-catalog.js';
import { getPluginsDir, upsertInstalledPlugin } from './plugin-store.js';

type ResolvedPluginSource = Exclude<PluginInstallSource, { kind: 'registry' }>;

const execFileAsync = promisify(execFile);

export type InstallPluginSkill = (options: {
  piwinRoot: string;
  source: InstallSource;
  name?: string;
}) => Promise<{ skillId: string }>;

export type InstallPluginOptions = {
  piwinRoot: string;
  source: PluginInstallSource;
  /**
   * Skill installer, injected by the host (marketplace does not depend on
   * `@piwin/skills`). Required: a plugin must never report success while its
   * skills were silently skipped.
   */
  installSkill: InstallPluginSkill;
  /** Secret values collected from the user, keyed by secret name. */
  secrets?: Record<string, string>;
  /**
   * Injected keychain write. Host provides createSecretResolver().writeProviderSecret
   * or equivalent. If omitted, secrets are skipped (used in tests).
   */
  writeSecret?: (ref: string, value: string) => Promise<void>;
  /**
   * Injected MCP server merge. Host provides a callback that loads mcp.json,
   * adds the server, and saves. If omitted, MCP merge is skipped (used in tests).
   */
  mergeMcpServer?: (serverId: string, config: McpServerConfig) => Promise<void>;
  /**
   * Resolve a registry source to a concrete InstallSource. Host provides this
   * by looking up the registry index. If omitted, registry sources throw.
   */
  resolveRegistrySource?: (registryId: string, ref?: string) => Promise<InstallSource>;
};

export async function installPlugin(options: InstallPluginOptions): Promise<InstallPluginResult> {
  const pluginsDir = getPluginsDir(options.piwinRoot);
  await mkdir(pluginsDir, { recursive: true });

  // 1. Resolve source to a concrete InstallSource.
  const concreteSource = await resolveSource(options);

  // 2. Materialize into cache dir.
  const materializedDir = await materializeSource(pluginsDir, concreteSource);

  // 3. Parse manifest.
  const manifestPath = join(materializedDir, 'plugin.json');
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read plugin.json: ${message}`);
  }
  const manifest = parsePluginManifest(manifestRaw);

  // 4. Install skills through the injected port.
  const installedSkills: string[] = [];
  if (manifest.skills) {
    for (const skillPath of manifest.skills) {
      const absoluteSkillPath = join(materializedDir, skillPath);
      const result = await options.installSkill({
        piwinRoot: options.piwinRoot,
        source: { kind: 'local', path: absoluteSkillPath },
      });
      installedSkills.push(result.skillId);
    }
  }

  // 5. Write secrets to keychain (before MCP merge so env placeholders resolve).
  const secretRefs: string[] = [];
  if (manifest.secrets && options.writeSecret) {
    for (const decl of manifest.secrets) {
      const value = options.secrets?.[decl.name];
      if (value === undefined || value.length === 0) {
        if (decl.required) {
          throw new Error(`Required secret "${decl.name}" was not provided`);
        }
        continue;
      }
      const ref = secretRef(manifest.id, decl.name);
      await options.writeSecret(ref, value);
      secretRefs.push(decl.name);
    }
  } else if (manifest.secrets) {
    // No writeSecret injected — still validate required secrets.
    for (const decl of manifest.secrets) {
      const value = options.secrets?.[decl.name];
      if ((value === undefined || value.length === 0) && decl.required) {
        throw new Error(`Required secret "${decl.name}" was not provided`);
      }
    }
  }

  // 6. Merge MCP servers (namespaced).
  const mcpServerIds: string[] = [];
  if (manifest.mcpServers) {
    for (const [serverId, serverConfig] of Object.entries(manifest.mcpServers)) {
      const namespaced = namespacedId(manifest.id, serverId);
      const resolvedEnv = serverConfig.env
        ? resolveSecretEnv(serverConfig.env, options.secrets ?? {})
        : undefined;
      const mergedConfig: McpServerConfig = {
        command: serverConfig.command,
      };
      if (serverConfig.args) {
        mergedConfig.args = resolveSecretArgs(serverConfig.args, options.secrets ?? {});
      }
      if (resolvedEnv) {
        mergedConfig.env = resolvedEnv;
      }
      if (serverConfig.disabled !== undefined) {
        mergedConfig.disabled = serverConfig.disabled;
      }
      if (serverConfig.restartOnCrash !== undefined) {
        mergedConfig.restartOnCrash = serverConfig.restartOnCrash;
      }
      if (options.mergeMcpServer) {
        await options.mergeMcpServer(namespaced, mergedConfig);
      }
      mcpServerIds.push(namespaced);
    }
  }

  // 7. Persist installed state.
  await upsertInstalledPlugin(options.piwinRoot, {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    installedAt: new Date().toISOString(),
    source: concreteSource,
    skills: installedSkills,
    mcpServerIds,
    secrets: secretRefs,
    manifestPath,
  });

  return {
    pluginId: manifest.id,
    installedSkills,
    mcpServerIds,
    secretRefs,
  };
}

async function resolveSource(options: InstallPluginOptions): Promise<ResolvedPluginSource> {
  const source = options.source;
  if (source.kind === 'registry') {
    const featured = findFeaturedPlugin(source.registryId);
    if (featured) {
      return { kind: 'bundled', bundledId: featured.id };
    }
    if (!options.resolveRegistrySource) {
      throw new Error(
        `Cannot install from registry "${source.registryId}" without resolveRegistrySource`,
      );
    }
    return options.resolveRegistrySource(source.registryId, source.ref);
  }
  return source;
}

async function materializeSource(
  pluginsDir: string,
  source: ResolvedPluginSource,
): Promise<string> {
  if (source.kind === 'bundled') {
    return materializeBundled(pluginsDir, source.bundledId);
  }
  if (source.kind === 'local') {
    return materializeLocal(pluginsDir, source.path);
  }
  return materializeGit(pluginsDir, source);
}

async function materializeBundled(pluginsDir: string, bundledId: string): Promise<string> {
  const featured = findFeaturedPlugin(bundledId);
  if (!featured) {
    throw new Error(`Unknown bundled plugin "${bundledId}"`);
  }
  const targetPath = join(
    pluginsDir,
    'cache',
    `bundled-${featured.manifest.id}@${featured.manifest.version}`,
  );
  await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
  const gitSource = featured.gitSource;
  if (gitSource) {
    const args = ['clone', '--depth', '1'];
    if (gitSource.ref) {
      args.push('--branch', gitSource.ref);
    }
    args.push(gitSource.url, targetPath);
    try {
      await execFileAsync('git', args, { timeout: 120_000 });
    } catch (error) {
      await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`git clone failed: ${message}`);
    }
  } else {
    await mkdir(targetPath, { recursive: true });
  }
  await writeFile(
    join(targetPath, 'plugin.json'),
    `${JSON.stringify(featured.manifest, null, 2)}\n`,
    'utf8',
  );
  return targetPath;
}

async function materializeLocal(pluginsDir: string, sourcePath: string): Promise<string> {
  const absoluteSource = resolve(sourcePath);
  const sourceStat = await stat(absoluteSource);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Plugin source must be a directory: ${absoluteSource}`);
  }
  const targetName = `cache-${basename(absoluteSource)}-${Date.now().toString(36)}`;
  const targetPath = join(pluginsDir, 'cache', targetName);
  await mkdir(targetPath, { recursive: true });
  await cp(absoluteSource, targetPath, { recursive: true, force: true });
  return targetPath;
}

async function materializeGit(
  pluginsDir: string,
  source: Extract<InstallSource, { kind: 'git' }>,
): Promise<string> {
  const tempName = `.tmp-git-plugin-${Date.now().toString(36)}`;
  const clonePath = join(pluginsDir, 'cache', tempName);
  const args = ['clone', '--depth', '1'];
  if (source.ref) {
    args.push('--branch', source.ref);
  }
  args.push(source.url, clonePath);
  try {
    await execFileAsync('git', args, { timeout: 120_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git clone failed: ${message}`);
  }

  let contentRoot: string;
  try {
    contentRoot = resolve(clonePath, normalizeRepositorySubdir(source.subdir));
  } catch (error) {
    await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  // Move into a stable name based on repo basename.
  const stableName = basename(source.url).replace(/\.git$/, '');
  const targetPath = join(pluginsDir, 'cache', stableName);
  await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
  await cp(contentRoot, targetPath, { recursive: true, force: true });
  await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
  return targetPath;
}
