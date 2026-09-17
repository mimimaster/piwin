/**
 * Pick the macOS code-signing identity for Desktop packages.
 * An ad-hoc signature changes identity every build, so macOS TCC forgets
 * Desktop / removable-volume grants and re-prompts on first file access.
 * A stable Developer ID keeps those grants across builds.
 */

/**
 * @param {string} output `security find-identity -v -p codesigning` stdout
 * @returns {string[]} Developer ID Application identity names
 */
export function parseDeveloperIdIdentities(output) {
  const names = new Set();
  for (const line of output.split('\n')) {
    const match = /^\s*\d+\)\s+[0-9A-F]{40}\s+"(Developer ID Application: [^"]+)"/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/**
 * @param {{ envIdentity: string | undefined, findIdentityOutput: () => string }} input
 * @returns {{ kind: 'env' | 'keychain', identity: string } | { kind: 'none' } | { kind: 'ambiguous', candidates: string[] }}
 */
export function resolveSigningIdentity(input) {
  const fromEnv = input.envIdentity?.trim();
  if (fromEnv) return { kind: 'env', identity: fromEnv };
  const candidates = parseDeveloperIdIdentities(input.findIdentityOutput());
  if (candidates.length === 1) return { kind: 'keychain', identity: candidates[0] };
  if (candidates.length === 0) return { kind: 'none' };
  return { kind: 'ambiguous', candidates };
}
