/**
 * Local provider: scans ~/.piwin/pets for user-installed pets and supports
 * installing from a local directory (the old installPetFromLocalPath behavior).
 */
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetManifest,
  PetResolvedPackage,
} from '@piwin/contracts';
import { normalizeLocalPetPath } from '../local-import.js';
import { validatePetManifest } from '../validate-manifest.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

async function readManifest(dir: string): Promise<PetManifest | null> {
  try {
    const raw = await readFile(join(dir, 'pet.json'), 'utf8');
    const result = validatePetManifest(JSON.parse(raw));
    return result.ok ? result.manifest : null;
  } catch {
    return null;
  }
}

function toEntry(manifest: PetManifest, dir: string, issues: string[]): PetDiscoveredEntry {
  const entry: PetDiscoveredEntry = {
    petId: manifest.id,
    displayName: manifest.displayName,
    manifest,
    source: 'local',
    location: dir,
    installed: true,
    issues,
  };
  if (manifest.description) entry.description = manifest.description;
  if (manifest.version) entry.version = manifest.version;
  return entry;
}

export const localProvider: PetSourceProvider = {
  kind: 'local',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.petsDir);
    } catch {
      return [];
    }
    const out: PetDiscoveredEntry[] = [];
    for (const entry of entries) {
      const dir = join(ctx.petsDir, entry);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = await readManifest(dir);
      if (!manifest) continue;
      const issues: string[] = [];
      try {
        await stat(join(dir, manifest.spritesheetPath));
      } catch {
        issues.push(`missing spritesheet: ${manifest.spritesheetPath}`);
      }
      out.push(toEntry(manifest, dir, issues));
    }
    return out;
  },

  async resolve(ctx: PetSourceProviderContext, petId: string): Promise<PetResolvedPackage> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.petsDir);
    } catch {
      throw new Error(`local pet not found: ${petId}`);
    }
    for (const entry of entries) {
      const dir = join(ctx.petsDir, entry);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(dir, manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      const result: PetResolvedPackage = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'local',
        packagePath: dir,
        spritesheetAbsolutePath,
        manifest,
      };
      if (manifest.description) result.description = manifest.description;
      if (manifest.version) result.version = manifest.version;
      return result;
    }
    throw new Error(`local pet not found: ${petId}`);
  },

  async install(
    ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult> {
    const absolute = normalizeLocalPetPath(location);
    if (!absolute) throw new Error('sourcePath required');
    const manifestPath = join(absolute, 'pet.json');
    const raw = await readFile(manifestPath, 'utf8');
    const validated = validatePetManifest(JSON.parse(raw));
    if (!validated.ok) {
      throw new Error(validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }
    const sheet = join(absolute, validated.manifest.spritesheetPath);
    try {
      if (!(await stat(sheet)).isFile()) {
        throw new Error('not a file');
      }
    } catch {
      throw new Error(`missing spritesheet: ${validated.manifest.spritesheetPath}`);
    }
    const target = join(ctx.petsDir, validated.manifest.id);
    await mkdir(ctx.petsDir, { recursive: true });
    await cp(absolute, target, { recursive: true, force: true });
    return { petId: validated.manifest.id, source: 'local', path: target };
  },
};
