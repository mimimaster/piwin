import {
  ensureBundledPromptsInstalled,
  getPiwinRoot,
  loadDiscoveredResources,
  loadPiwinConfig,
} from '@piwin/host-runtime';
import { parseProject } from './cli-args.js';

/**
 * `piwin prompt` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandPrompt(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);

  if (sub === 'list') {
    await ensureBundledPromptsInstalled(root);
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      projectPath: parseProject(argv),
      ...(config.prompts ? { promptsConfig: config.prompts } : {}),
    });
    const prompts = discovered.prompts;
    if (prompts.length === 0) {
      console.log('(no prompt templates under ~/.piwin/prompts or Pi packages)');
      return;
    }
    for (const prompt of prompts) {
      const flag = prompt.enabled ? 'on ' : 'off';
      console.log(`${flag}\t${prompt.id}\t${prompt.source}\t${prompt.name}\t${prompt.path}`);
    }
    return;
  }

  console.error(`Unknown prompt subcommand: ${sub}`);
  console.error('Usage: piwin prompt list');
  process.exitCode = 1;
}
