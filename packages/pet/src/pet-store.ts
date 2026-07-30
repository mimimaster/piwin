/**
 * Pet store facade: preference persistence + provider registry.
 * All enumeration/resolution/install is delegated to PetSourceRegistry.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  PetAnimationState,
  PetManifest,
  PetPreference,
  PetRuntimeSnapshot,
  PetStoreQueryResult,
  PetSummary,
} from '@piwin/contracts';
import { resolvePetLayout } from './validate-manifest.js';
import {
  createPetSourceRegistry,
  discoverAllPets,
  installPet,
  queryPetStore,
  resolvePet,
  type PetSourceRegistry,
} from './pet-source-registry.js';
import { bundledProvider } from './sources/bundled-provider.js';
import { localProvider } from './sources/local-provider.js';
import { codexProvider } from './sources/codex-provider.js';
import { registryProvider } from './sources/registry-provider.js';

export function getPetsDir(piwinRoot: string): string {
  return join(piwinRoot, 'pets');
}

export function getPetPreferencePath(piwinRoot: string): string {
  return join(piwinRoot, 'pet.json');
}

export function getDefaultCodexPetsDir(): string {
  return join(homedir(), '.codex', 'pets');
}

let registrySingleton: PetSourceRegistry | null = null;

function getRegistry(): PetSourceRegistry {
  if (!registrySingleton) {
    registrySingleton = createPetSourceRegistry([
      bundledProvider,
      localProvider,
      codexProvider,
      registryProvider,
    ]);
  }
  return registrySingleton;
}

function buildContext(piwinRoot: string) {
  return {
    piwinRoot,
    petsDir: getPetsDir(piwinRoot),
    codexPetsDir: getDefaultCodexPetsDir(),
  };
}

export async function loadPetPreference(piwinRoot: string): Promise<PetPreference> {
  try {
    const raw = await readFile(getPetPreferencePath(piwinRoot), 'utf8');
    const parsed = JSON.parse(raw) as { activePetId?: string };
    if (typeof parsed.activePetId === 'string' && parsed.activePetId.trim()) {
      return { activePetId: parsed.activePetId.trim() };
    }
  } catch {
    // default
  }
  return { activePetId: 'piwin-default' };
}

export async function savePetPreference(
  piwinRoot: string,
  preference: PetPreference,
): Promise<void> {
  const path = getPetPreferencePath(piwinRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(preference, null, 2)}\n`, 'utf8');
}

export async function listPets(piwinRoot: string): Promise<{
  pets: PetSummary[];
  activePetId: string;
}> {
  const preference = await loadPetPreference(piwinRoot);
  const ctx = buildContext(piwinRoot);
  const entries = await discoverAllPets(getRegistry(), ctx);
  const pets: PetSummary[] = entries.map((entry) => {
    const summary: PetSummary = {
      id: entry.petId,
      displayName: entry.displayName,
      path: entry.location,
      spritesheetAbsolutePath: entry.location, // resolved lazily via loadPetManifest
      source: entry.source,
      active: entry.petId === preference.activePetId,
      valid: entry.issues.length === 0,
      issues: entry.issues,
    };
    if (entry.description) summary.description = entry.description;
    return summary;
  });
  pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { pets, activePetId: preference.activePetId };
}

export async function loadPetManifest(
  piwinRoot: string,
  petId: string,
): Promise<{ manifest: PetManifest; packagePath: string; spritesheetAbsolutePath: string }> {
  const ctx = buildContext(piwinRoot);
  const resolved = await resolvePet(getRegistry(), ctx, petId);
  return {
    manifest: resolved.manifest,
    packagePath: resolved.packagePath,
    spritesheetAbsolutePath: resolved.spritesheetAbsolutePath,
  };
}

export async function getActivePet(
  piwinRoot: string,
  state: PetAnimationState = 'idle',
): Promise<PetRuntimeSnapshot> {
  const preference = await loadPetPreference(piwinRoot);
  let petId = preference.activePetId;
  try {
    return await buildRuntimeSnapshot(piwinRoot, petId, state);
  } catch {
    petId = 'piwin-default';
    return buildRuntimeSnapshot(piwinRoot, petId, state);
  }
}

async function buildRuntimeSnapshot(
  piwinRoot: string,
  petId: string,
  state: PetAnimationState,
): Promise<PetRuntimeSnapshot> {
  const loaded = await loadPetManifest(piwinRoot, petId);
  const layout = resolvePetLayout(loaded.manifest);
  return {
    petId: loaded.manifest.id,
    displayName: loaded.manifest.displayName,
    spritesheetAbsolutePath: loaded.spritesheetAbsolutePath,
    state,
    fps: layout.fps,
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    cols: layout.cols,
    rows: layout.rows,
    stateRows: layout.stateRows,
  };
}

export async function setActivePet(piwinRoot: string, petId: string): Promise<PetRuntimeSnapshot> {
  await loadPetManifest(piwinRoot, petId);
  await savePetPreference(piwinRoot, { activePetId: petId });
  return getActivePet(piwinRoot, 'idle');
}

export async function installPetFromLocalPath(
  piwinRoot: string,
  sourcePath: string,
): Promise<{ petId: string; path: string }> {
  const ctx = buildContext(piwinRoot);
  const result = await installPet(getRegistry(), ctx, 'local', sourcePath);
  return { petId: result.petId, path: result.path };
}

export async function installPetFromRegistry(
  piwinRoot: string,
  entryJson: string,
): Promise<{ petId: string; path: string }> {
  const ctx = buildContext(piwinRoot);
  const result = await installPet(getRegistry(), ctx, 'registry', entryJson);
  return { petId: result.petId, path: result.path };
}

export async function queryRemotePetStore(
  piwinRoot: string,
  query: string,
): Promise<PetStoreQueryResult[]> {
  const ctx = buildContext(piwinRoot);
  return queryPetStore(getRegistry(), ctx, query);
}
