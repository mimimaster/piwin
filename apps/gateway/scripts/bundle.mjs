#!/usr/bin/env node
/**
 * Bundles the relay into one self-contained ESM file for `node` or Docker:
 * apps/gateway/dist/piwin-gateway.mjs. Workspace packages and `ws` are
 * inlined; ws's optional native speedups stay external (it falls back to JS).
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(appDirectory, 'dist', 'piwin-gateway.mjs');

await build({
  entryPoints: [join(appDirectory, 'src', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['bufferutil', 'utf-8-validate'],
  // ws is CommonJS; give the ESM bundle a require for its internals.
  banner: {
    js: "import { createRequire as __piwinCreateRequire } from 'node:module';\nconst require = __piwinCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`[bundle-gateway] ${outfile}`);
