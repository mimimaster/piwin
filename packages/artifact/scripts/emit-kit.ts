/**
 * Writes kit/v1/kit.js, the file the desktop binary serves at
 * `piwin-artifact://localhost/lib/v1/kit.js` (crates/artifact-webview).
 *
 *   cd packages/artifact && pnpm exec tsx scripts/emit-kit.ts
 *
 * `kit-file.test.ts` fails when the committed file drifts from the source.
 */
import { writeFileSync } from 'node:fs';
import { buildArtifactKitV1Script } from '../src/kit/index.js';

writeFileSync(new URL('../kit/v1/kit.js', import.meta.url), buildArtifactKitV1Script());
console.log('wrote kit/v1/kit.js');
