/**
 * Registry provider: queries a remote CodexPetHub-compatible catalog and
 * installs pets by downloading + validating + extracting into ~/.piwin/pets.
 * Extraction is delegated to the host (unzip) — this provider validates the
 * manifest post-extract. For now we assume the registry serves a directory
 * zip (no internal nesting); if a top-level folder is present we use it.
 */
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetStoreQueryResult,
} from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import { downloadAndVerifyPackage } from './registry-download.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

export type RegistryProviderContext = PetSourceProviderContext & {
  /** HTTPS catalog URL. */
  registryUrl?: string;
  /** Override fetch (tests). */
  fetch?: typeof fetch;
};

const DEFAULT_REGISTRY_URL = 'https://codexpethub.com/catalog.json';

type CatalogEntry = {
  id: string;
  displayName: string;
  description?: string;
  version?: string;
  url: string;
  sha256: string;
  sizeBytes: number;
};

function resolveCtx(ctx: PetSourceProviderContext): RegistryProviderContext {
  const override = ctx as RegistryProviderContext;
  return {
    ...ctx,
    registryUrl: override.registryUrl ?? DEFAULT_REGISTRY_URL,
    ...(override.fetch ? { fetch: override.fetch } : {}),
  };
}

async function isInstalled(petsDir: string, petId: string): Promise<boolean> {
  try {
    await stat(join(petsDir, petId, 'pet.json'));
    return true;
  } catch {
    return false;
  }
}

export const registryProvider: PetSourceProvider = {
  kind: 'registry',

  async discover(): Promise<PetDiscoveredEntry[]> {
    // Registry pets are not enumerated in pet/list — only via explicit query.
    return [];
  },

  async resolve(): Promise<never> {
    // Registry pets must be installed before resolve; the local provider
    // handles post-install resolution from ~/.piwin/pets.
    throw new Error('registry pets must be installed before resolution');
  },

  async queryStore(
    ctx: PetSourceProviderContext,
    query: string,
  ): Promise<PetStoreQueryResult[]> {
    const reg = resolveCtx(ctx);
    const fetchFn = reg.fetch ?? fetch;
    const response = await fetchFn(reg.registryUrl ?? DEFAULT_REGISTRY_URL, {
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`registry query failed: HTTP ${response.status}`);
    }
    const entries = (await response.json()) as CatalogEntry[];
    const q = query.trim().toLowerCase();
    const out: PetStoreQueryResult[] = [];
    for (const entry of entries) {
      if (
        q &&
        !entry.id.toLowerCase().includes(q) &&
        !entry.displayName.toLowerCase().includes(q)
      ) {
        continue;
      }
      const installed = await isInstalled(ctx.petsDir, entry.id);
      const result: PetStoreQueryResult = {
        petId: entry.id,
        displayName: entry.displayName,
        source: 'registry',
        location: entry.url,
        installed,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      };
      if (entry.description) result.description = entry.description;
      if (entry.version) result.version = entry.version;
      out.push(result);
    }
    return out;
  },

  async install(
    ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult> {
    // location is either a JSON-encoded catalog entry (carrying sha256/size)
    // or a bare package URL — in the bare case we re-query the catalog to
    // recover the checksum/size before downloading.
    const reg = resolveCtx(ctx);
    let entry: CatalogEntry;
    try {
      entry = JSON.parse(location) as CatalogEntry;
    } catch {
      const results = await registryProvider.queryStore!(ctx, '');
      const match = results.find((r) => r.location === location);
      if (!match || !match.sha256 || match.sizeBytes === undefined) {
        throw new Error(`registry entry not found for url: ${location}`);
      }
      entry = {
        id: match.petId,
        displayName: match.displayName,
        url: match.location,
        sha256: match.sha256,
        sizeBytes: match.sizeBytes,
      };
    }

    const staging = join(ctx.piwinRoot, 'pets', '.staging', entry.id);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const downloaded = await downloadAndVerifyPackage(
      entry,
      staging,
      reg.fetch ? { fetch: reg.fetch } : {},
    );

    // Extract via host `unzip` (Node has no stdlib zip; keeps pkg dep-free).
    // macOS/Linux ship unzip; Windows follow-up tracked separately.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('unzip', ['-o', downloaded.filePath, '-d', staging]);

    // Locate the extracted pet dir: a single top-level folder, else staging.
    let petDir = staging;
    const children = await readdir(staging);
    const nonZipChildren = children.filter((name) => !name.endsWith('.zip'));
    if (nonZipChildren.length === 1) {
      const candidate = join(staging, nonZipChildren[0]!);
      try {
        if ((await stat(candidate)).isDirectory()) petDir = candidate;
      } catch {
        // keep staging as petDir
      }
    }

    // Validate manifest post-extract; reject invalid packages.
    const raw = await readFile(join(petDir, 'pet.json'), 'utf8');
    const validated = validatePetManifest(JSON.parse(raw));
    if (!validated.ok) {
      await rm(staging, { recursive: true, force: true });
      throw new Error(
        validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      );
    }

    // Atomic install: rm target then rename staged dir into place.
    const target = join(ctx.petsDir, validated.manifest.id);
    await mkdir(ctx.petsDir, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(petDir, target);
    await rm(staging, { recursive: true, force: true });
    return { petId: validated.manifest.id, source: 'registry', path: target };
  },
};
