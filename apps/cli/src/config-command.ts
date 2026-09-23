import { getPiwinRoot, initPiwinConfig, loadPiwinConfig } from '@piwin/host-runtime';

/**
 * `piwin config` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandConfig(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'show';
  if (sub === 'init') {
    const result = await initPiwinConfig();
    console.log(result.created ? `created ${result.path}` : `already exists ${result.path}`);
    return;
  }
  if (sub === 'show') {
    const root = getPiwinRoot();
    const config = await loadPiwinConfig(root);
    console.log(JSON.stringify({ root, config }, null, 2));
    return;
  }
  console.error(`Unknown config subcommand: ${sub}`);
  process.exitCode = 1;
}
