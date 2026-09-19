import { join } from 'node:path';

/** Matches the Rust packaged-host placeholder guard in host_bridge.rs. */
export const PLACEHOLDER_HOST_SERVE_MAX_BYTES = 200;

/**
 * @param {string} appPath
 */
export function packagedAppLayout(appPath) {
  const resourcesHost = join(appPath, 'Contents', 'Resources', 'host');
  return {
    macosBinary: join(appPath, 'Contents', 'MacOS', 'piwin-desktop'),
    sidecarNode: join(appPath, 'Contents', 'MacOS', 'piwin-host'),
    hostServe: join(resourcesHost, 'host-serve.mjs'),
    agentWorker: join(resourcesHost, 'agent-worker.mjs'),
    hostPackageJson: join(resourcesHost, 'package.json'),
    bundledAssets: join(resourcesHost, 'bundled-assets'),
    lancedbNative: join(
      resourcesHost,
      'node_modules',
      '@lancedb',
      'lancedb-darwin-arm64',
      'lancedb.darwin-arm64.node',
    ),
  };
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
export function selectPackagedAppNames(names) {
  return names.filter((name) => name.endsWith('.app'));
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
export function selectPackagedDmgNames(names) {
  return names.filter((name) => name.endsWith('.dmg'));
}

/**
 * Tauri deletes macos/*.app after writing the DMG. CI then only has the
 * installer; local trees may still have both.
 *
 * @param {string[]} appNames
 * @param {string[]} dmgNames
 * @returns {{ kind: 'app', appName: string, dmgName: string } | { kind: 'dmg', dmgName: string } | { kind: 'missing-dmg' } | { kind: 'ambiguous-app', appNames: string[] }}
 */
export function resolvePackagedVerifyTarget(appNames, dmgNames) {
  if (dmgNames.length < 1) {
    return { kind: 'missing-dmg' };
  }
  if (appNames.length > 1) {
    return { kind: 'ambiguous-app', appNames };
  }
  if (appNames.length === 1) {
    const appName = appNames[0];
    const dmgName = dmgNames[0];
    if (!appName || !dmgName) return { kind: 'missing-dmg' };
    return { kind: 'app', appName, dmgName };
  }
  const dmgName = dmgNames[0];
  if (!dmgName) return { kind: 'missing-dmg' };
  return { kind: 'dmg', dmgName };
}

/**
 * @param {number} byteLength
 */
export function isPlaceholderHostServe(byteLength) {
  return byteLength < PLACEHOLDER_HOST_SERVE_MAX_BYTES;
}

/**
 * @param {string} dump `codesign -d --verbose=2` stderr/stdout
 * @returns {{ adhoc: boolean, developerId: boolean, teamId: string | undefined, identity: string | undefined }}
 */
export function interpretCodesignDump(dump) {
  const developerIdMatch = /Authority=(Developer ID Application: .+)/.exec(dump);
  const teamIdMatch = /TeamIdentifier=([A-Z0-9]+)/.exec(dump);
  const adhoc = /\badhoc\b/i.test(dump) || /Signature=adhoc/.test(dump);
  return {
    adhoc: adhoc && !developerIdMatch,
    developerId: Boolean(developerIdMatch),
    teamId: teamIdMatch?.[1],
    identity: developerIdMatch?.[1],
  };
}
