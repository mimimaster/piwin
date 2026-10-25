import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostBookEntry } from '@piwin/contracts';
import { HostBook, RemoteHostVault, type KeyValueStorage } from '@piwin/host-client';
// The subpath keeps attached-client commands off the Host runtime (no Pi load).
import { readOwnerOnlyTextFile, writeOwnerOnlyTextFile } from '@piwin/host-server/owner-only-file';

/** CLI copy of ADR 0101 shell state, under `<piwinRoot>/client/` (owner-only files). */
export type CliRemoteHosts = {
  hostBook: HostBook;
  vault: RemoteHostVault;
  /** `piwin hosts use`: the Host every command attaches to without `PIWIN_HOST`. */
  readDefaultHostId: () => Promise<string | undefined>;
  writeDefaultHostId: (hostId: string | undefined) => Promise<void>;
  /** Alias, host id, or a unique Host name. */
  findHost: (selector: string) => Promise<HostBookEntry | undefined>;
  /** Legacy endpoint → host id once `PIWIN_HOST_URL` has been migrated. */
  readLegacyMigration: (endpoint: string) => Promise<string | undefined>;
  writeLegacyMigration: (endpoint: string, hostId: string) => Promise<void>;
};

/** One file per key in `directory`; values are the strings host-client hands over. */
export function createFileKeyValueStorage(directory: string): KeyValueStorage {
  const pathOf = (key: string): string =>
    join(directory, `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  return {
    read: (key) => readOwnerOnlyTextFile(pathOf(key), key),
    write: (key, value) => writeOwnerOnlyTextFile(pathOf(key), value, key),
    remove: async (key) => {
      await rm(pathOf(key), { force: true });
    },
  };
}

export function openCliRemoteHosts(piwinRoot: string): CliRemoteHosts {
  const clientDirectory = join(piwinRoot, 'client');
  const state = createFileKeyValueStorage(clientDirectory);
  const hostBook = new HostBook(state, (error) =>
    console.error(`[piwin] host book is damaged and was ignored: ${error.message}`),
  );
  const vault = new RemoteHostVault(createFileKeyValueStorage(join(clientDirectory, 'hosts')));
  const readJson = async (key: string): Promise<Record<string, string>> => {
    const raw = await state.read(key);
    try {
      const value: unknown = raw === undefined ? {} : JSON.parse(raw);
      return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  return {
    hostBook,
    vault,
    readDefaultHostId: async () => (await readJson('default-host')).hostId,
    writeDefaultHostId: async (hostId) => {
      if (hostId === undefined) await state.remove('default-host');
      else await state.write('default-host', JSON.stringify({ hostId }));
    },
    findHost: async (selector) => {
      const wanted = selector.trim();
      const entries = await hostBook.list();
      const byAlias = entries.find((entry) => entry.alias?.toLowerCase() === wanted.toLowerCase());
      const byId = entries.find((entry) => entry.hostId === wanted);
      const byName = entries.filter(
        (entry) => entry.hostName.toLowerCase() === wanted.toLowerCase(),
      );
      return byAlias ?? byId ?? (byName.length === 1 ? byName[0] : undefined);
    },
    readLegacyMigration: async (endpoint) => (await readJson('legacy-migrations'))[endpoint],
    writeLegacyMigration: async (endpoint, hostId) => {
      const migrations = await readJson('legacy-migrations');
      await state.write('legacy-migrations', JSON.stringify({ ...migrations, [endpoint]: hostId }));
    },
  };
}
