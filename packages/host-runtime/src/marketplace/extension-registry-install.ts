/**
 * Install an extension from any `ExtensionInstallSource` (ADR 0077). Registry
 * references resolve to a pinned Git commit and stage through the managed
 * revision store; they never run `pi install` or npm.
 *
 * Shared by the `extensions/install` Host command and `piwin extension install`.
 */
import {
  DEFAULT_EXTENSION_REGISTRY_INDEX_URL,
  type ExtensionInstallSource,
  type ExtensionRegistryIndex,
} from '@piwin/contracts';
import { installExtension, type InstallExtensionResult } from '@piwin/extensions';
import {
  createRegistryIndexLoader,
  resolveRegistryInstall,
  type RegistryIndexLoader,
} from '@piwin/marketplace';

export type InstallExtensionFromSourceOptions = {
  piwinRoot: string;
  source: ExtensionInstallSource;
  name?: string;
  loadRegistryIndex?: (signal?: AbortSignal) => Promise<ExtensionRegistryIndex>;
};

export type InstallExtensionFromSourceResult = InstallExtensionResult & {
  /** Present for registry installs: the exact version and commit staged. */
  registry?: { id: string; version: string; commit: string };
};

/** Registry index URL: `PIWIN_EXTENSION_REGISTRY_URL` or the default Pages index. */
export function getExtensionRegistryIndexUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIWIN_EXTENSION_REGISTRY_URL?.trim() || DEFAULT_EXTENSION_REGISTRY_INDEX_URL;
}

let sharedLoader: RegistryIndexLoader | undefined;

/** One cached loader per Host process and registry URL. */
export function getSharedExtensionRegistryLoader(): RegistryIndexLoader {
  const url = getExtensionRegistryIndexUrl();
  if (!sharedLoader || sharedLoader.url !== url) {
    sharedLoader = createRegistryIndexLoader({
      url,
      onDiagnostics: (diagnostics) => {
        console.warn(`[extension-registry] skipped ${diagnostics.length} invalid entries:`);
        for (const line of diagnostics) console.warn(`[extension-registry]   ${line}`);
      },
    });
  }
  return sharedLoader;
}

export async function installExtensionFromSource(
  options: InstallExtensionFromSourceOptions,
): Promise<InstallExtensionFromSourceResult> {
  const { source } = options;
  if (source.kind !== 'registry') {
    return installExtension({
      piwinRoot: options.piwinRoot,
      source,
      ...(options.name ? { name: options.name } : {}),
    });
  }
  const loadIndex =
    options.loadRegistryIndex ?? ((signal) => getSharedExtensionRegistryLoader().load(signal));
  const resolved = resolveRegistryInstall(await loadIndex(), {
    id: source.id,
    ...(source.version ? { version: source.version } : {}),
  });
  const result = await installExtension({
    piwinRoot: options.piwinRoot,
    source: {
      kind: 'git',
      url: resolved.repository,
      ...(resolved.subdir ? { subdir: resolved.subdir } : {}),
    },
    pinnedCommit: resolved.commit,
    // The owner-qualified name keeps an original and its fork apart.
    name: resolved.installName,
    version: resolved.version,
    sourceLocator: resolved.sourceLocator,
  });
  return {
    ...result,
    registry: { id: resolved.id, version: resolved.version, commit: resolved.commit },
  };
}
