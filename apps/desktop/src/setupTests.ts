/**
 * Desktop vitest setup. Keep this file Artifact-safe and free of product stubs
 * so unrelated suites are not rewritten.
 */
import { beforeEach } from 'vitest';
import { clearArtifactHeightsForTests } from './artifact/artifact-height-memory';
import { clearMediaAspectsForTests } from './media/media-aspect-memory';
try {
  Object.defineProperty(document, 'compatMode', {
    configurable: true,
    get: () => 'CSS1Compat',
  });
} catch {
  // happy-dom may expose a non-configurable compatMode; KaTeX then warns.
}

// Remembered sizes (artifact heights, image proportions) are module-level
// caches backed by localStorage. Start every test without them, so one test's
// measured frame never becomes another's bootstrap height.

beforeEach(() => {
  clearArtifactHeightsForTests();
  clearMediaAspectsForTests();
});
