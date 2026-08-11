/**
 * Codex-live provider: reads the Codex desktop app's selected avatar from
 * ~/.codex/config.toml and resolves it to a renderable pet. Custom pets live
 * under ~/.codex/pets/<name>/; built-in avatars (codex, dewey, fireball, …)
 * are extracted to ~/.piwin/pets/ by the host's extraction step and resolved
 * by the local provider. This provider's job is to surface the codex-selected
 * pet so piwin can mirror the user's Codex choice.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PetDiscoveredEntry, PetManifest, PetResolvedPackage } from '@piwin/contracts';
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

/**
 * Parse ~/.codex/config.toml [desktop] section for selected-avatar-id.
 * Minimal TOML parser — only handles `key = "value"` under `[desktop]`.
 */
async function readCodexSelectedAvatar(codexHome: string): Promise<string | null> {
  try {
    const raw = await readFile(join(codexHome, 'config.toml'), 'utf8');
    let inDesktop = false;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) {
        inDesktop = trimmed === '[desktop]';
        continue;
      }
      if (!inDesktop) continue;
      const match = /^selected-avatar-id\s*=\s*"([^"]+)"/.exec(trimmed);
      if (match) return match[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Map codex avatar-id to a petId in ~/.piwin/pets/. */
function resolveCodexAvatarId(avatarId: string): string {
  // custom:<name> → look for <name> in ~/.codex/pets/
  if (avatarId.startsWith('custom:')) {
    return avatarId.slice('custom:'.length);
  }
  // Built-in avatars map to extracted pets in ~/.piwin/pets/
  return avatarId;
}

export const codexProvider: PetSourceProvider = {
  kind: 'codex-live',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    const out: PetDiscoveredEntry[] = [];
    // Scan ~/.codex/pets/ for custom pets.
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.codexPetsDir);
    } catch {
      // dir missing is normal
    }
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
        manifest,
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
    // First try ~/.codex/pets/<petId>/ (custom pets).
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.codexPetsDir);
    } catch {
      // dir missing is normal
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

/**
 * Read the codex-selected avatar id from ~/.codex/config.toml and return
 * the corresponding petId that piwin should activate. Returns null if codex
 * is not installed or no avatar is selected.
 */
export async function getCodexSelectedPetId(
  codexHome: string = join(homedir(), '.codex'),
): Promise<string | null> {
  const avatarId = await readCodexSelectedAvatar(codexHome);
  if (!avatarId) return null;
  return resolveCodexAvatarId(avatarId);
}
