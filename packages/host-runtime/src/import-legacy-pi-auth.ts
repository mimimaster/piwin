/**
 * One-time import of ~/.pi/agent/auth.json into the Host-owned pi-agent dir.
 * Only the default product root (~/.piwin) inherits legacy credentials.
 * Test/custom roots stay empty so they do not share production OAuth.
 */
import { copyFile, mkdir, chmod, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getPiAgentDir, getPiwinPiAgentDir, getPiwinRoot } from './paths.js';

export type ImportLegacyPiAuthResult = 'imported' | 'already-present' | 'skipped';

export async function importLegacyPiSubscriptionAuthIfNeeded(options: {
  piwinRoot?: string;
  legacyAuthPath?: string;
  defaultProductRoot?: string;
} = {}): Promise<ImportLegacyPiAuthResult> {
  const root = getPiwinRoot(options.piwinRoot);
  const destinationDir = getPiwinPiAgentDir(root);
  await mkdir(destinationDir, { recursive: true });
  try {
    await chmod(destinationDir, 0o700);
  } catch {
    // Directory mode is best-effort on filesystems that reject chmod.
  }
  const destinationAuthPath = join(destinationDir, 'auth.json');
  try {
    await access(destinationAuthPath);
    return 'already-present';
  } catch {
    // Host auth store is missing; maybe import from Pi CLI.
  }
  const defaultProductRoot = options.defaultProductRoot ?? join(homedir(), '.piwin');
  if (root !== defaultProductRoot) {
    return 'skipped';
  }
  const legacyAuthPath = options.legacyAuthPath ?? join(getPiAgentDir(), 'auth.json');
  try {
    await copyFile(legacyAuthPath, destinationAuthPath);
    await chmod(destinationAuthPath, 0o600);
    return 'imported';
  } catch {
    return 'skipped';
  }
}
