/**
 * Desktop vitest setup. Keep this file Artifact-safe and free of product stubs
 * so unrelated suites are not rewritten.
 */
try {
  Object.defineProperty(document, 'compatMode', {
    configurable: true,
    get: () => 'CSS1Compat',
  });
} catch {
  // happy-dom may expose a non-configurable compatMode; KaTeX then warns.
}
