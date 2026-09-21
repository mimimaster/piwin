/**
 * Local all-in-one Desktop packaging helpers. Tauri's bundle_dmg.sh and
 * Apple's timestamp server fail on a full system volume or leftover rw.*.dmg
 * mounts; recover by detaching those images and rewriting the DMG with
 * hdiutil on a roomier disk.
 */

/** Prefer an extra volume when the system disk cannot hold a RW temp DMG (~2x .app). */
export const PACKAGE_SYSTEM_FREE_BYTES_MIN = 8 * 1024 * 1024 * 1024;

/**
 * @param {string} hdiutilInfo `hdiutil info` stdout
 * @returns {string[]}
 */
export function leftoverPiwinDmgImagePaths(hdiutilInfo) {
  const paths = [];
  for (const line of hdiutilInfo.split('\n')) {
    const match = /^\s*image-path\s*:\s*(.+)\s*$/.exec(line);
    if (!match) continue;
    const imagePath = match[1].trim();
    if (/\/rw\.\d+\.[^/]+\.dmg$/i.test(imagePath)) {
      paths.push(imagePath);
    }
  }
  return paths;
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
export function leftoverRwDmgFileNames(names) {
  return names.filter((name) => name.startsWith('rw.') && name.endsWith('.dmg'));
}

/**
 * @param {string} combinedOutput
 * @returns {'codesign' | 'bundle-dmg' | 'other'}
 */
export function classifyDesktopPackageFailure(combinedOutput) {
  if (/timestamp service is not available/i.test(combinedOutput) || /failed to sign app/i.test(combinedOutput)) {
    return 'codesign';
  }
  if (/bundle_dmg\.sh/i.test(combinedOutput) || /failed to bundle project/i.test(combinedOutput)) {
    return 'bundle-dmg';
  }
  return 'other';
}

/**
 * @param {{
 *   envTmpdir?: string,
 *   platform: string,
 *   systemAvailBytes: number,
 *   extraTmpdir?: string,
 *   osTmpdir: string,
 *   minSystemFreeBytes?: number,
 * }} input
 */
export function pickPackageTempDir(input) {
  const fromEnv = input.envTmpdir?.trim();
  if (fromEnv) return fromEnv;
  const minFree = input.minSystemFreeBytes ?? PACKAGE_SYSTEM_FREE_BYTES_MIN;
  if (input.platform === 'darwin' && input.systemAvailBytes < minFree && input.extraTmpdir) {
    return input.extraTmpdir;
  }
  return input.osTmpdir;
}

/**
 * POSIX `df -kP` available column, in bytes.
 * @param {string} dfOutput
 */
export function parseDfAvailBytes(dfOutput) {
  const lines = dfOutput.trim().split('\n');
  const dataLine = lines.length >= 2 ? lines[1] : lines[0];
  if (!dataLine) return 0;
  const columns = dataLine.split(/\s+/);
  const avail1k = Number(columns[3]);
  if (!Number.isFinite(avail1k) || avail1k < 0) return 0;
  return avail1k * 1024;
}

/**
 * @param {string} version
 * @param {string} arch `process.arch`
 */
export function canonicalDesktopDmgFileName(version, arch) {
  const tripleArch = arch === 'arm64' ? 'aarch64' : arch;
  return `piwin_${version}_${tripleArch}.dmg`;
}

/**
 * @param {{ path: string, mtimeMs: number }[]} apps
 * @returns {string | undefined}
 */
export function newestAppPath(apps) {
  if (apps.length === 0) return undefined;
  const sorted = [...apps].sort((left, right) => right.mtimeMs - left.mtimeMs);
  return sorted[0]?.path;
}
