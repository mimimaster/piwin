/**
 * Pet store facade: preference persistence + provider registry.
 * All enumeration/resolution/install is delegated to PetSourceRegistry.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  PetAnimationState,
  PetInstallResult,
  PetLocalImportBatchResult,
  PetLocalImportPreview,
  PetManifest,
  PetPreference,
  PetRuntimeSnapshot,
  PetStoreQueryResult,
  PetSummary,
} from '@piwin/contracts';
import { resolvePetLayout } from './validate-manifest.js';
import { scanLocalPetPackages } from './local-import.js';
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
import { codexProvider, getCodexSelectedPetId } from './sources/codex-provider.js';
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
    // no saved preference — fall through to codex detection
  }
  // No piwin preference saved; mirror the user's Codex avatar choice if set.
  const codexPetId = await getCodexSelectedPetId();
  if (codexPetId) {
    // Verify the pet actually exists before adopting it as the default.
    try {
      await buildRuntimeSnapshot(piwinRoot, codexPetId, 'idle');
      return { activePetId: codexPetId };
    } catch {
      // codex pet not installed in piwin — fall through to default
    }
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
      spritesheetAbsolutePath: entry.manifest
        ? join(entry.location, entry.manifest.spritesheetPath)
        : entry.location,
      source: entry.source,
      active: entry.petId === preference.activePetId,
      valid: entry.issues.length === 0,
      issues: entry.issues,
    };
    if (entry.description) summary.description = entry.description;
    if (entry.manifest) summary.manifest = entry.manifest;
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
): Promise<PetInstallResult> {
  const ctx = buildContext(piwinRoot);
  return installPet(getRegistry(), ctx, 'local', sourcePath);
}

export async function scanLocalPets(sourcePath: string): Promise<PetLocalImportPreview> {
  return scanLocalPetPackages(sourcePath);
}

/**
 * Import several already-validated local package paths while retaining
 * per-package failures so one broken package does not hide successful imports.
 */
export async function installPetFromLocalPaths(
  piwinRoot: string,
  sourcePaths: readonly string[],
): Promise<PetLocalImportBatchResult> {
  const uniqueSourcePaths = [...new Set(sourcePaths.map((path) => path.trim()).filter(Boolean))];
  if (uniqueSourcePaths.length === 0) throw new Error('at least one source path is required');

  const installed: PetInstallResult[] = [];
  const failed: PetLocalImportBatchResult['failed'] = [];
  for (const sourcePath of uniqueSourcePaths) {
    try {
      installed.push(await installPetFromLocalPath(piwinRoot, sourcePath));
    } catch (error) {
      failed.push({
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { installed, failed };
}

/**
 * Install from the registry provider.
 * `entryJson` may be:
 *   - a bare CodexPetHub slug (`blankie`) → install-manifest API
 *   - a JSON-encoded catalog entry with url/sha256 → zip download
 *   - a bare package URL (legacy)
 */
export async function installPetFromRegistry(
  piwinRoot: string,
  entryJson: string,
  signal?: AbortSignal,
): Promise<{ petId: string; path: string }> {
  const ctx = buildContext(piwinRoot);
  const result = await installPet(getRegistry(), ctx, 'registry', entryJson, signal);
  return { petId: result.petId, path: result.path };
}

export async function queryRemotePetStore(
  piwinRoot: string,
  query: string,
  signal?: AbortSignal,
): Promise<PetStoreQueryResult[]> {
  const ctx = buildContext(piwinRoot);
  return queryPetStore(getRegistry(), ctx, query, signal);
}

/**
 * Delete a user-installed pet package from the local pets directory.
 * Bundled pets (`piwin-default` etc.) cannot be deleted.
 * If the deleted pet is currently active, automatically falls back to
 * `piwin-default` and returns the new active snapshot.
 */
export async function deletePet(
  piwinRoot: string,
  petId: string,
): Promise<{ fallbackPet?: PetRuntimeSnapshot }> {
  // Resolve the pet to verify it exists and check its source.
  const ctx = buildContext(piwinRoot);
  const entries = await discoverAllPets(getRegistry(), ctx);
  const entry = entries.find((e) => e.petId === petId);
  if (!entry) {
    throw new Error(`Pet "${petId}" not found`);
  }
  if (entry.source === 'bundled') {
    throw new Error(`Cannot delete bundled pet "${petId}"`);
  }

  // Only delete pets whose files live under ~/.piwin/pets/.
  const petsDir = getPetsDir(piwinRoot);
  const petDir = join(petsDir, petId);
  if (!entry.location.startsWith(petsDir)) {
    throw new Error(
      `Pet "${petId}" is located outside the managed pets directory and cannot be deleted from here`,
    );
  }
  await rm(petDir, { recursive: true, force: true });

  // If the deleted pet was active, fall back to the default.
  const preference = await loadPetPreference(piwinRoot);
  if (preference.activePetId === petId) {
    const fallbackPet = await setActivePet(piwinRoot, 'piwin-default');
    return { fallbackPet };
  }
  return {};
}
