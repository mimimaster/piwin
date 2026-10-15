/**
 * Writes kit/v1/kit.js and kit/v1/viz.js, the files the desktop binary serves
 * under `piwin-artifact://localhost/lib/v1/` (crates/artifact-webview).
 *
 *   cd packages/artifact && pnpm exec tsx scripts/emit-kit.ts
 *
 * `kit-file.test.ts` fails when the committed file drifts from the source.
 */
import { writeFileSync } from 'node:fs';
import { buildArtifactKitV1Script, buildArtifactVizScript } from '../src/kit/index.js';

writeFileSync(new URL('../kit/v1/kit.js', import.meta.url), buildArtifactKitV1Script());
writeFileSync(new URL('../kit/v1/viz.js', import.meta.url), buildArtifactVizScript());
console.log('wrote kit/v1/kit.js, kit/v1/viz.js');
