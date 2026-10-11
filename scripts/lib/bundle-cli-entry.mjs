import { join } from 'node:path';
import { build } from 'esbuild';

/** Keep unused Host commands and their external imports out of attached CLI startup. */
export function bundleCliEntry({ root, outdir, external }) {
  return build({
    entryPoints: { 'host-serve': join(root, 'apps/cli/src/index.ts') },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outdir,
    splitting: true,
    chunkNames: 'cli-chunk-[hash]',
    // Workers and native module resolution use import.meta.url's directory.
    // Keep chunks beside the entry instead of introducing a nested directory.
    outExtension: { '.js': '.mjs' },
    metafile: true,
    packages: 'bundle',
    external,
    banner: {
      js: "import { createRequire as __piwinCreateRequire } from 'node:module'; const require = __piwinCreateRequire(import.meta.url);",
    },
    logLevel: 'info',
  });
}
