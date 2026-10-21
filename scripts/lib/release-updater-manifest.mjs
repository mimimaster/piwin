/**
 * In-app updater manifests (ADR 0097). One static Tauri-format file per
 * platform at `updater/<os>-<arch>.json`: the Tauri static format carries a
 * single `version`, so a release that skipped Windows must not move the
 * Windows file. `releases.json` stays the download page's source.
 */

/** releases.json platform → Tauri `{{target}}-{{arch}}`. */
export const UPDATER_PLATFORM_KEYS = {
  'macos-aarch64': 'darwin-aarch64',
  'windows-x64': 'windows-x86_64',
};

/** @param {string} platform a releases.json platform key */
export function updaterPlatformKey(platform) {
  const key = UPDATER_PLATFORM_KEYS[/** @type {keyof typeof UPDATER_PLATFORM_KEYS} */ (platform)];
  if (!key) throw new Error(`no updater platform for ${platform}`);
  return key;
}

/** @param {string} updaterPlatform e.g. darwin-aarch64 */
export function updaterManifestKey(updaterPlatform) {
  return `updater/${updaterPlatform}.json`;
}

/**
 * The macOS updater bundle (the `.app`, archived). Windows updates install
 * the published NSIS `-setup.exe` itself.
 *
 * @param {string} version
 */
export function macUpdaterBundleFileName(version) {
  return `piwinwin_${version}_aarch64.app.tar.gz`;
}

/**
 * Plain text: the update notice renders it as preformatted lines.
 *
 * @param {{ title: string, items: string[] }[]} groups
 */
export function renderUpdaterNotes(groups) {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const items = group.items.map((item) => `- ${item}`).join('\n');
      return group.title ? `${group.title}\n${items}` : items;
    })
    .join('\n\n');
}

/**
 * @param {{
 *   version: string, notes: string, pubDate: string,
 *   updaterPlatform: string, url: string, signature: string,
 * }} input
 */
export function buildUpdaterManifest(input) {
  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.pubDate,
    platforms: {
      [input.updaterPlatform]: { url: input.url, signature: input.signature.trim() },
    },
  };
}

/**
 * `tauri signer generate` writes the `.pub` file as the same base64 text the
 * config expects; whitespace is the only tolerated difference.
 *
 * @param {unknown} tauriConf parsed tauri.conf.json
 */
export function configuredUpdaterPublicKey(tauriConf) {
  if (typeof tauriConf !== 'object' || tauriConf === null) return undefined;
  const plugins = /** @type {{ plugins?: { updater?: { pubkey?: unknown } } }} */ (tauriConf)
    .plugins;
  const pubkey = plugins?.updater?.pubkey;
  return typeof pubkey === 'string' && pubkey.trim() ? pubkey.trim() : undefined;
}

/**
 * @param {string | undefined} configured
 * @param {string | undefined} keyFilePub contents of `<privateKeyPath>.pub`
 */
export function updaterPublicKeysMatch(configured, keyFilePub) {
  return Boolean(configured && keyFilePub && configured === keyFilePub.trim());
}
