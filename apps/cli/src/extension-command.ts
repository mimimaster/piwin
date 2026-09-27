import { EXTENSION_COMPAT_NOTE } from './extension-compat-note.js';
import {
  createExtensionRevisionStore,
  ensureBundledExtensionsInstalled,
  getPiwinRoot,
  installExtension,
  installExtensionFromSource,
  loadDiscoveredResources,
  loadPiwinConfig,
} from '@piwin/host-runtime';
import { parseRegistryReference } from '@piwin/marketplace';
import { resolve } from 'node:path';
import { parseProject, readOption } from './cli-args.js';

/**
 * `piwin extension` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandExtension(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);

  if (sub === 'list') {
    await ensureBundledExtensionsInstalled(root);
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      projectPath: parseProject(argv),
      ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
    });
    const extensions = discovered.extensions;
    console.log(EXTENSION_COMPAT_NOTE);
    if (extensions.length === 0) {
      console.log('(no extensions found under ~/.piwin/extensions or Pi packages)');
      return;
    }
    for (const extension of extensions) {
      const flag = extension.enabled ? 'on ' : 'off';
      console.log(
        `${flag}\t${extension.id}\t${extension.source}\t${extension.name}\t${extension.path}`,
      );
    }
    return;
  }

  if (sub === 'ensure-bundled') {
    const installed = await ensureBundledExtensionsInstalled(root);
    if (installed.length === 0) {
      console.log('(bundled extensions already present or none found)');
    } else {
      for (const name of installed) {
        console.log(`installed bundled extension: ${name}`);
      }
    }
    return;
  }

  if (sub === 'install') {
    const localPath = readOption(argv, '--local');
    const gitUrl = readOption(argv, '--git');
    const name = readOption(argv, '--name');
    const subdir = readOption(argv, '--subdir');
    const ref = readOption(argv, '--ref');
    const registryReference = readOption(argv, '--registry');
    if (registryReference) {
      const result = await installExtensionFromSource({
        piwinRoot: root,
        source: { kind: 'registry', ...parseRegistryReference(registryReference) },
        ...(name ? { name } : {}),
      });
      console.log(EXTENSION_COMPAT_NOTE);
      console.log(
        `installed extension ${result.extensionId} (${result.registry?.id}@${result.registry?.version}, commit ${result.registry?.commit}) -> ${result.targetPath}`,
      );
      console.log(`installed extensions start disabled; run: piwin extension enable ${result.extensionId}`);
      return;
    }
    if (localPath) {
      const installOptions: Parameters<typeof installExtension>[0] = {
        piwinRoot: root,
        source: { kind: 'local', path: resolve(localPath) },
      };
      if (name) installOptions.name = name;
      const result = await installExtension(installOptions);
      console.log(EXTENSION_COMPAT_NOTE);
      console.log(`installed extension ${result.extensionId} -> ${result.targetPath}`);
      return;
    }
    if (gitUrl) {
      const installOptions: Parameters<typeof installExtension>[0] = {
        piwinRoot: root,
        source: {
          kind: 'git',
          url: gitUrl,
          ...(subdir ? { subdir } : {}),
          ...(ref ? { ref } : {}),
        },
      };
      if (name) installOptions.name = name;
      const result = await installExtension(installOptions);
      console.log(EXTENSION_COMPAT_NOTE);
      console.log(`installed extension ${result.extensionId} -> ${result.targetPath}`);
      return;
    }
    console.error(
      'Usage: piwin extension install --registry <owner>/<name>[@version] | --local <file|dir> | --git <url> [--subdir <path>] [--ref <branch|tag>] [--name <id>]',
    );
    process.exitCode = 1;
    return;
  }

  if (sub === 'enable' || sub === 'disable') {
    const extensionId = argv[2];
    if (!extensionId) {
      console.error(`Usage: piwin extension ${sub} <extension-id>`);
      process.exitCode = 1;
      return;
    }
    const store = createExtensionRevisionStore(root);
    if (!(await store.getRecord(extensionId))) {
      console.error(
        `${extensionId} is not a managed extension; toggle Pi-native or bundled extensions in Settings → Extensions`,
      );
      process.exitCode = 1;
      return;
    }
    // Enabling runs third-party code with this user's OS privileges (ADR 0047).
    await store.setEnabled(extensionId, sub === 'enable');
    console.log(`${sub}d ${extensionId}; new sessions pick it up`);
    return;
  }

  console.error(`Unknown extension subcommand: ${sub}`);
  console.error('Usage: piwin extension list | ensure-bundled | install | enable | disable');
  process.exitCode = 1;
}
