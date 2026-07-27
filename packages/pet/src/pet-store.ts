/**
 * List / install / activate pets under ~/.piwin/pets.
 * Optional import from ~/.codex/pets (copy, not symlink).
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
  let entries: string[] = [];
  try {
    entries = await readdir(petsDir);
  } catch {
    entries = [];
  }
  const pets: PetSummary[] = [];
  for (const entry of entries) {
    const petPath = join(petsDir, entry);
    const source: PetSummary['source'] =
      entry === 'piwin-default' ? 'bundled' : entry.startsWith('codex-') ? 'codex-import' : 'user';
    const summary = await loadPackageAt(petPath, source, preference.activePetId);
    if (summary) pets.push(summary);
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
  // Prefer directory named by id, else scan
  const candidates = [join(petsDir, petId)];
  try {
    for (const entry of await readdir(petsDir)) {
      candidates.push(join(petsDir, entry));
    }
  } catch {
    // empty
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

export async function setActivePet(
  piwinRoot: string,
  petId: string,
): Promise<PetRuntimeSnapshot> {
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

/**
 * Copy packages from ~/.codex/pets into ~/.piwin/pets with codex- prefix if needed.
 */
export async function importPetsFromCodex(
  piwinRoot: string,
  codexPetsDir?: string,
): Promise<{ imported: string[]; skipped: string[]; errors: string[] }> {
  const sourceRoot = codexPetsDir ?? getDefaultCodexPetsDir();
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return { imported, skipped, errors: [`codex pets dir missing: ${sourceRoot}`] };
  }
  await mkdir(getPetsDir(piwinRoot), { recursive: true });
  for (const entry of entries) {
    const from = join(sourceRoot, entry);
    try {
      if (!(await stat(from)).isDirectory()) {
        skipped.push(entry);
        continue;
      }
      const raw = await readFile(join(from, 'pet.json'), 'utf8');
      const validated = validatePetManifest(JSON.parse(raw));
      if (!validated.ok) {
        errors.push(`${entry}: ${validated.issues.map((i) => i.message).join(', ')}`);
        continue;
      }
      const targetName = validated.manifest.id;
      const to = join(getPetsDir(piwinRoot), targetName);
      try {
        await stat(join(to, 'pet.json'));
        skipped.push(targetName);
        continue;
      } catch {
        // copy
      }
      await cp(from, to, { recursive: true });
      imported.push(targetName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${entry}: ${message}`);
    }
  }
  return { imported, skipped, errors };
}
