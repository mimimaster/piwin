import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Devin writes the *full* (never elided) transcript next to its summaries as
 * `history_<16 hex>.md`, then points the replacement message at that path.
 */
export const HISTORY_FILE_PREFIX = 'history_';
export const HISTORY_FILE_SUFFIX = '.md';

export function resolveCompactRoot(customRoot?: string): string {
  if (customRoot) return customRoot;
  const fromEnv = process.env.PIWIN_ROOT?.trim();
  if (fromEnv) return join(fromEnv, 'compact');
  return join(homedir(), '.piwin', 'compact');
}

export function historyFileName(): string {
  return `${HISTORY_FILE_PREFIX}${randomBytes(8).toString('hex')}${HISTORY_FILE_SUFFIX}`;
}

export type ArchivedHistory = { fileName: string; filePath: string };

export async function writeHistoryFile(
  root: string,
  text: string,
): Promise<ArchivedHistory> {
  await mkdir(root, { recursive: true });
  const fileName = historyFileName();
  const filePath = join(root, fileName);
  await writeFile(filePath, text, 'utf8');
  return { fileName, filePath };
}
