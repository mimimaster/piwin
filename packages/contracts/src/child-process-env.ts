/**
 * Minimal environment a Host-spawned child process needs on Windows.
 *
 * Workers and hooks run with a hand-trimmed env (no secrets). Windows
 * children still need these system variables to function at all: without
 * `SystemRoot` Node loses DNS and `tmpdir()`, without `COMSPEC`/`PATHEXT`
 * executables do not resolve. None of them carry secrets.
 */
export const WINDOWS_CHILD_SYSTEM_ENV_KEYS = [
  'SystemRoot',
  'SystemDrive',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'COMSPEC',
  'PATHEXT',
] as const;

/**
 * Pick the Windows system variables from `source`. Returns an empty record on
 * any other platform so POSIX child environments stay unchanged.
 */
export function pickWindowsChildSystemEnv(
  platform: string,
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  if (platform !== 'win32') return picked;
  for (const key of WINDOWS_CHILD_SYSTEM_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}
