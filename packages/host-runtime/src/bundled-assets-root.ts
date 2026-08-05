/**
 * Bundled asset resolution for packaged host (ADR 0017 / plan S0).
 * When PIWIN_BUNDLED_ASSETS_ROOT is set, assets live under that root with a
 * stable layout path. Otherwise fall back to import.meta.url-relative dirs (dev).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIWIN_BUNDLED_ASSETS_ROOT_ENV = 'PIWIN_BUNDLED_ASSETS_ROOT';

export function resolveBundledAssetsRoot(options: {
  /** Path under the env override root, e.g. `agent-host/bundled-prompts`. */
  layoutPath: string;
  moduleUrl: string;
  relativeFallback: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options.env ?? process.env;
  const root = env[PIWIN_BUNDLED_ASSETS_ROOT_ENV]?.trim();
  if (root) {
    return join(root, options.layoutPath);
  }
  return join(dirname(fileURLToPath(options.moduleUrl)), options.relativeFallback);
}
