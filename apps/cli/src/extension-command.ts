import { EXTENSION_COMPAT_NOTE } from './extension-compat-note.js';
import {
  ensureBundledExtensionsInstalled,
  getPiwinRoot,
  loadDiscoveredResources,
  loadPiwinConfig,
} from '@piwin/host-runtime';
import { installExtension } from '@piwin/marketplace';
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
      'Usage: piwin extension install --local <file|dir> | --git <url> [--subdir <path>] [--ref <branch|tag>] [--name <id>]',
    );
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown extension subcommand: ${sub}`);
  console.error('Usage: piwin extension list | ensure-bundled | install');
  process.exitCode = 1;
}
