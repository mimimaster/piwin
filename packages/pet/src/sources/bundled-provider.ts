/**
 * Bundled provider: enumerates pets shipped with the @piwin/pet package
 * (under pet/bundled/*). Does not install — bundled pets are read in place.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetManifest,
  PetResolvedPackage,
} from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import { resolveBundledAssetsRoot } from '../bundled-assets-root.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

export type BundledProviderContext = PetSourceProviderContext & {
  /** Override the bundled root for tests. */
  bundledRoot?: string;
};

function resolveBundledRoot(ctx: PetSourceProviderContext, override?: string): string {
  if (override) return override;
  return resolveBundledAssetsRoot({
    layoutPath: 'pet/bundled',
    moduleUrl: import.meta.url,
    relativeFallback: '../bundled',
  });
}

async function readManifest(dir: string): Promise<PetManifest | null> {
  try {
    const raw = await readFile(join(dir, 'pet.json'), 'utf8');
    const result = validatePetManifest(JSON.parse(raw));
    return result.ok ? result.manifest : null;
  } catch {
    return null;
  }
}

export const bundledProvider: PetSourceProvider = {
  kind: 'bundled',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    const root = resolveBundledRoot(ctx, (ctx as BundledProviderContext).bundledRoot);
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }
    const out: PetDiscoveredEntry[] = [];
    for (const entry of entries) {
      const dir = join(root, entry);
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
        manifest,
        source: 'bundled',
        location: dir,
        installed: false,
        issues,
      };
      if (manifest.description) summary.description = manifest.description;
      if (manifest.version) summary.version = manifest.version;
      out.push(summary);
    }
    return out;
  },

  async resolve(ctx: PetSourceProviderContext, petId: string): Promise<PetResolvedPackage> {
    const root = resolveBundledRoot(ctx, (ctx as BundledProviderContext).bundledRoot);
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      throw new Error(`bundled pet not found: ${petId}`);
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(dir, manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      const result: PetResolvedPackage = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'bundled',
        packagePath: dir,
        spritesheetAbsolutePath,
        manifest,
      };
      if (manifest.description) result.description = manifest.description;
      if (manifest.version) result.version = manifest.version;
      return result;
    }
    throw new Error(`bundled pet not found: ${petId}`);
  },

  async install(
    _ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult> {
    // Bundled pets are read in place; "install" is a no-op that returns the path.
    return { petId: '', source: 'bundled', path: location };
  },
};
