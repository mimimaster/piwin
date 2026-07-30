/**
 * Codex-live provider: scans ~/.codex/pets in place. Pets are shared with
 * Codex without being copied. No install — codex pets are read-only.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetManifest,
  PetResolvedPackage,
} from '@piwin/contracts';
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

export const codexProvider: PetSourceProvider = {
  kind: 'codex-live',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.codexPetsDir);
    } catch {
      return [];
    }
    const out: PetDiscoveredEntry[] = [];
    for (const entry of entries) {
      const dir = join(ctx.codexPetsDir, entry);
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
      const summary: PetDiscoveredEntry = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'codex-live',
        location: dir,
        installed: true,
        issues,
      };
      if (manifest.description) summary.description = manifest.description;
      if (manifest.version) summary.version = manifest.version;
      out.push(summary);
    }
    return out;
  },

  async resolve(ctx: PetSourceProviderContext, petId: string): Promise<PetResolvedPackage> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.codexPetsDir);
    } catch {
      throw new Error(`codex pet not found: ${petId}`);
    }
    for (const entry of entries) {
      const dir = join(ctx.codexPetsDir, entry);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(dir, manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      const result: PetResolvedPackage = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'codex-live',
        packagePath: dir,
        spritesheetAbsolutePath,
        manifest,
      };
      if (manifest.description) result.description = manifest.description;
      if (manifest.version) result.version = manifest.version;
      return result;
    }
    throw new Error(`codex pet not found: ${petId}`);
  },
};
