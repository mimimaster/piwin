import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIWIN_BUNDLED_ASSETS_ROOT_ENV = 'PIWIN_BUNDLED_ASSETS_ROOT';

export function resolveBundledAssetsRoot(options: {
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

export function resolveBundledSkillsRoot(env?: NodeJS.ProcessEnv): string {
  return resolveBundledAssetsRoot({
    layoutPath: 'skills',
    moduleUrl: import.meta.url,
    relativeFallback: '../../../skills',
    ...(env ? { env } : {}),
  });
}
