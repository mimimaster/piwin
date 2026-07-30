/**
 * Pet source registry: orders providers by PET_SOURCE_PRIORITY, dedupes by
 * petId (earlier provider wins), and isolates provider failures so one
 * broken source does not break enumeration.
 */
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetResolvedPackage,
  PetSourceKind,
  PetStoreQueryResult,
} from '@piwin/contracts';
import {
  PET_SOURCE_PRIORITY,
  type PetSourceProvider,
  type PetSourceProviderContext,
} from './sources/pet-source-provider.js';

export type PetSourceRegistry = {
  providers: readonly PetSourceProvider[];
  byKind: ReadonlyMap<PetSourceKind, PetSourceProvider>;
};

export function createPetSourceRegistry(
  providers: PetSourceProvider[],
): PetSourceRegistry {
  const sorted = [...providers].sort(
    (a, b) =>
      PET_SOURCE_PRIORITY.indexOf(a.kind) - PET_SOURCE_PRIORITY.indexOf(b.kind),
  );
  const byKind = new Map<PetSourceKind, PetSourceProvider>();
  for (const p of sorted) byKind.set(p.kind, p);
  return { providers: sorted, byKind };
}

export async function discoverAllPets(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
): Promise<PetDiscoveredEntry[]> {
  const seen = new Set<string>();
  const out: PetDiscoveredEntry[] = [];
  for (const provider of registry.providers) {
    try {
      const entries = await provider.discover(ctx);
      for (const entry of entries) {
        if (seen.has(entry.petId)) continue;
        seen.add(entry.petId);
        out.push(entry);
      }
    } catch (error) {
      // Provider isolation — log and continue.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pet] provider ${provider.kind} discover failed: ${message}`);
    }
  }
  return out;
}

export async function resolvePet(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
  petId: string,
): Promise<PetResolvedPackage> {
  let lastError: Error | null = null;
  for (const provider of registry.providers) {
    try {
      return await provider.resolve(ctx, petId);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`pet not found: ${petId}`);
}

export async function installPet(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
  source: PetSourceKind,
  location: string,
): Promise<PetInstallResult> {
  const provider = registry.byKind.get(source);
  if (!provider || !provider.install) {
    throw new Error(`install not supported for source: ${source}`);
  }
  return provider.install(ctx, location);
}

export async function queryPetStore(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
  query: string,
): Promise<PetStoreQueryResult[]> {
  const provider = registry.byKind.get('registry');
  if (!provider || !provider.queryStore) return [];
  return provider.queryStore(ctx, query);
}
