import { rename } from 'node:fs/promises';

/** Backoff between attempts; ~1.6s total before the original error surfaces. */
const RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 400, 400] as const;

/**
 * Windows refuses to replace a file another process holds open without
 * FILE_SHARE_DELETE — antivirus, the search indexer, or an editor reading
 * config.json. Those holds are brief, so the rename is retried instead of
 * failing the user's settings change.
 */
function isTransientWindowsReplaceError(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

export async function replaceFileWithRetry(
  sourcePath: string,
  targetPath: string,
  options: {
    platform?: NodeJS.Platform;
    renameFile?: (from: string, to: string) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const renameFile = options.renameFile ?? rename;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(sourcePath, targetPath);
      return;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientWindowsReplaceError(error, platform)) throw error;
      await sleep(delay);
    }
  }
}
