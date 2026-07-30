/**
 * Provider abstraction for pet package sources.
 * Each provider owns one PetSourceKind and is isolated from the others:
 * a throw in discover/resolve/install must not cascade.
 */
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetResolvedPackage,
  PetSourceKind,
  PetStoreQueryResult,
} from '@piwin/contracts';

/** Fixed priority — earlier wins on id collisions. */
export const PET_SOURCE_PRIORITY: readonly PetSourceKind[] = [
  'bundled',
  'local',
  'codex-live',
  'registry',
];

/** Services handed to every provider. FS roots are absolute. */
export type PetSourceProviderContext = {
  /** ~/.piwin */
  piwinRoot: string;
  /** ~/.piwin/pets — install target for local + registry. */
  petsDir: string;
  /** ~/.codex/pets — codex-live scan root. */
  codexPetsDir: string;
};

export type PetSourceProvider = {
  readonly kind: PetSourceKind;
  /**
   * Enumerate pets available from this source without fetching payloads.
   * Must NOT perform network I/O. Throw on infrastructure failure —
   * the registry catches and logs.
   */
  discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]>;
  /**
   * Resolve a discovered entry into a renderable package (manifest + spritesheet path).
   * For registry this is only valid after install(); for local/codex/bundled it
   * reads from disk.
   */
  resolve(
    ctx: PetSourceProviderContext,
    petId: string,
  ): Promise<PetResolvedPackage>;
  /**
   * Install a pet into ~/.piwin/pets. Only registry + local implement this;
   * bundled/codex-live return a no-op result pointing at their existing path.
   */
  install?(
    ctx: PetSourceProviderContext,
    location: string,
    signal?: AbortSignal,
  ): Promise<PetInstallResult>;
  /**
   * Optional remote catalog query. Only registry implements this.
   */
  queryStore?(
    ctx: PetSourceProviderContext,
    query: string,
    signal?: AbortSignal,
  ): Promise<PetStoreQueryResult[]>;
};

// PetManifest is intentionally not re-exported here; consumers import
// contracts directly for type-only concerns.
