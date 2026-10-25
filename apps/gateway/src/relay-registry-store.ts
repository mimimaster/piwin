import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  emptyRelayRegistry,
  parseRelayRegistry,
  RelayRegistryError,
  type RelayRegistryState,
} from './relay-user-registry.js';

/**
 * Reads `users.json`. A missing file is an empty registry (a fresh relay); a
 * present but unreadable or invalid file is an error, so a typo never opens
 * the relay to nobody — or silently drops every user.
 */
export async function loadRelayRegistry(path: string): Promise<RelayRegistryState> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return emptyRelayRegistry();
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RelayRegistryError(`${path} is not valid JSON`);
  }
  return parseRelayRegistry(value);
}

/** Atomic replace, owner-only permissions. */
export async function saveRelayRegistry(path: string, state: RelayRegistryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}
