import { unwatchFile, watchFile, type Stats } from 'node:fs';
import { loadRelayRegistry } from './relay-registry-store.js';
import type { RelayLogger } from './relay-log.js';
import type { RelayUserRegistry } from './relay-user-registry.js';

/**
 * Picks up edits from `piwin-gateway user …` (or a hand edit) without a
 * restart. Polling, not fs.watch: it behaves the same on bind-mounted Docker
 * volumes. A file that fails to parse is reported and the last good registry
 * stays in force.
 */
export function watchRelayRegistry(input: {
  path: string;
  registry: RelayUserRegistry;
  onReloaded: () => void;
  log: RelayLogger;
  intervalMs?: number;
}): () => void {
  let reloading = Promise.resolve();
  const listener = (current: Stats, previous: Stats): void => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) {
      return;
    }
    reloading = reloading.then(() => reload());
  };
  watchFile(input.path, { interval: input.intervalMs ?? 2_000, persistent: false }, listener);
  return () => unwatchFile(input.path, listener);

  async function reload(): Promise<void> {
    try {
      input.registry.replace(await loadRelayRegistry(input.path));
      input.log({ kind: 'registry-reloaded', users: input.registry.list().length });
      input.onReloaded();
    } catch (error) {
      input.log({
        kind: 'registry-error',
        detail: error instanceof Error ? error.message : 'reload failed',
      });
    }
  }
}
