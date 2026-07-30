/**
 * List / install / activate pets under ~/.piwin/pets.
 * Also scans ~/.codex/pets live (in place, not copied) so codex pets are
 * shared without duplication. piwin-owned pets win on id collisions.
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  PetAnimationState,
  PetManifest,
  PetPreference,
  PetRuntimeSnapshot,
  PetSummary,
} from '@piwin/contracts';
import { resolvePetLayout, validatePetManifest } from './validate-manifest.js';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

export function getPetsDir(piwinRoot: string): string {
  return join(piwinRoot, 'pets');
}

export function getPetPreferencePath(piwinRoot: string): string {
  return join(piwinRoot, 'pet.json');
}

export function getDefaultCodexPetsDir(): string {
  return join(homedir(), '.codex', 'pets');
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

export async function ensureBundledPetsInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ??
    resolveBundledAssetsRoot({
      layoutPath: 'pet/bundled',
      moduleUrl: import.meta.url,
      relativeFallback: '../bundled',
    });
  const targetRoot = getPetsDir(piwinRoot);
  await mkdir(targetRoot, { recursive: true });
  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return [];
  }
  const installed: string[] = [];
  for (const entry of entries) {
    const from = join(sourceRoot, entry);
    const to = join(targetRoot, entry);
    try {
      if (!(await stat(from)).isDirectory()) continue;
      try {
        await stat(join(to, 'pet.json'));
        continue;
      } catch {
        // install
      }
      await cp(from, to, { recursive: true });
      installed.push(entry);
    } catch {
      // ignore single pet failures
    }
  }
  return installed;
}

async function loadPackageAt(
  petPath: string,
  source: PetSummary['source'],
  activePetId: string,
): Promise<PetSummary | null> {
  const manifestPath = join(petPath, 'pet.json');
  try {
    if (!(await stat(petPath)).isDirectory()) return null;
    const raw = await readFile(manifestPath, 'utf8');
    const validated = validatePetManifest(JSON.parse(raw));
    if (!validated.ok) {
      return {
        id: basename(petPath),
        displayName: basename(petPath),
        path: petPath,
        spritesheetAbsolutePath: '',
        source,
        active: false,
        valid: false,
        issues: validated.issues.map((issue) => `${issue.path}: ${issue.message}`),
      };
    }
    const sheetPath = join(petPath, validated.manifest.spritesheetPath);
    const issues: string[] = [];
    try {
      await stat(sheetPath);
    } catch {
      issues.push(`missing spritesheet: ${validated.manifest.spritesheetPath}`);
    }
    const summary: PetSummary = {
      id: validated.manifest.id,
      displayName: validated.manifest.displayName,
      path: petPath,
      spritesheetAbsolutePath: sheetPath,
      source,
      active: validated.manifest.id === activePetId,
      valid: issues.length === 0,
      issues,
    };
    if (validated.manifest.description) {
      summary.description = validated.manifest.description;
    }
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: basename(petPath),
      displayName: basename(petPath),
      path: petPath,
      spritesheetAbsolutePath: '',
      source,
      active: false,
      valid: false,
      issues: [message],
    };
  }
}

export async function listPets(piwinRoot: string): Promise<{
  pets: PetSummary[];
  activePetId: string;
}> {
  await ensureBundledPetsInstalled(piwinRoot);
  const preference = await loadPetPreference(piwinRoot);
  const petsDir = getPetsDir(piwinRoot);
  const pets: PetSummary[] = [];
  const seenIds = new Set<string>();

  // 1. piwin-owned pets first (bundled + user-installed + codex-import copies).
  let piwinEntries: string[] = [];
  try {
    piwinEntries = await readdir(petsDir);
  } catch {
    piwinEntries = [];
  }
  for (const entry of piwinEntries) {
    const petPath = join(petsDir, entry);
    const source: PetSummary['source'] =
      entry === 'piwin-default' ? 'bundled' : entry.startsWith('codex-') ? 'codex-import' : 'user';
    const summary = await loadPackageAt(petPath, source, preference.activePetId);
    if (summary) {
      pets.push(summary);
      seenIds.add(summary.id);
    }
  }

  // 2. Live codex pets — scanned in place, not copied. Skipped if piwin already
  //    has a pet with the same id (piwin-owned wins).
  const codexDir = getDefaultCodexPetsDir();
  let codexEntries: string[] = [];
  try {
    codexEntries = await readdir(codexDir);
  } catch {
    codexEntries = [];
  }
  for (const entry of codexEntries) {
    const petPath = join(codexDir, entry);
    const summary = await loadPackageAt(petPath, 'codex-live', preference.activePetId);
    if (summary && !seenIds.has(summary.id)) {
      pets.push(summary);
      seenIds.add(summary.id);
    }
  }

  pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { pets, activePetId: preference.activePetId };
}

export async function loadPetManifest(
  piwinRoot: string,
  petId: string,
): Promise<{ manifest: PetManifest; packagePath: string; spritesheetAbsolutePath: string }> {
  await ensureBundledPetsInstalled(piwinRoot);
  const petsDir = getPetsDir(piwinRoot);
  // Prefer directory named by id, else scan piwin pets, then scan codex live.
  const candidates = [join(petsDir, petId)];
  try {
    for (const entry of await readdir(petsDir)) {
      candidates.push(join(petsDir, entry));
    }
  } catch {
    // empty
  }
  const codexDir = getDefaultCodexPetsDir();
  candidates.push(join(codexDir, petId));
  try {
    for (const entry of await readdir(codexDir)) {
      candidates.push(join(codexDir, entry));
    }
  } catch {
    // codex dir missing — fine
  }
  for (const petPath of candidates) {
    try {
      const raw = await readFile(join(petPath, 'pet.json'), 'utf8');
      const validated = validatePetManifest(JSON.parse(raw));
      if (!validated.ok) continue;
      if (validated.manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(petPath, validated.manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      return {
        manifest: validated.manifest,
        packagePath: petPath,
        spritesheetAbsolutePath,
      };
    } catch {
      // try next
    }
  }
  throw new Error(`pet not found or invalid: ${petId}`);
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
  const absolute = sourcePath.trim();
  if (!absolute) throw new Error('sourcePath required');
  const manifestPath = join(absolute, 'pet.json');
  const raw = await readFile(manifestPath, 'utf8');
  const validated = validatePetManifest(JSON.parse(raw));
  if (!validated.ok) {
    throw new Error(validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  }
  const sheet = join(absolute, validated.manifest.spritesheetPath);
  await stat(sheet);
  const target = join(getPetsDir(piwinRoot), validated.manifest.id);
  await mkdir(getPetsDir(piwinRoot), { recursive: true });
  await cp(absolute, target, { recursive: true });
  return { petId: validated.manifest.id, path: target };
}
