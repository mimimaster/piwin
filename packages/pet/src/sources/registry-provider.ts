/**
 * Registry provider: installs pets into ~/.piwin/pets from:
 *   1. CodexPetHub install-manifest by slug (npx codexpethub install <slug>)
 *   2. JSON-encoded catalog entry / zip URL (legacy / custom registries)
 *   3. Optional catalog.json query for browse (best-effort; may 404)
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetRegistryEntry,
  PetStoreQueryResult,
} from '@piwin/contracts';
import { parsePetInstallInput } from '../pet-install-input.js';
import { validatePetManifest } from '../validate-manifest.js';
import { installPetFromSlug, isPetSlug, type InstallManifestOptions } from './install-manifest.js';
import { installPetFromCodexPetsNet, type CodexPetsNetOptions } from './codex-pets-net.js';
import { downloadAndVerifyPackage, type DownloadOptions } from './registry-download.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

const execFileAsync = promisify(execFile);

export type RegistryProviderContext = PetSourceProviderContext & {
  /** HTTPS catalog URL (optional browse). */
  registryUrl?: string;
  /** Override fetch (tests). */
  fetch?: typeof fetch;
  /**
   * Override the host unzip step (tests). Receives the downloaded zip path
   * and the staging dir; must extract the archive contents into staging.
   */
  unzip?: (zipPath: string, destDir: string) => Promise<void>;
  /** CodexPetHub origin for install-manifest (default https://codexpethub.com). */
  registryOrigin?: string;
  /** Extra allowed hosts for install-manifest assets (tests). */
  allowedHosts?: ReadonlySet<string>;
  /**
   * Preferred registry when installing by bare slug:
   *   - 'codexpethub' (default) → install-manifest API
   *   - 'codex-pets-net'         → codex-pets.net zip download
   * If the preferred registry 404s, the other is tried as a fallback.
   */
  preferredSlugRegistry?: 'codexpethub' | 'codex-pets-net';
};

const DEFAULT_REGISTRY_URL = 'https://codexpethub.com/catalog.json';

/** Default host extraction via the `unzip` CLI (macOS/Linux). */
async function defaultUnzip(zipPath: string, destDir: string): Promise<void> {
  await execFileAsync('unzip', ['-o', zipPath, '-d', destDir]);
}

function resolveCtx(ctx: PetSourceProviderContext): RegistryProviderContext {
  const override = ctx as RegistryProviderContext;
  return {
    ...ctx,
    registryUrl: override.registryUrl ?? DEFAULT_REGISTRY_URL,
    ...(override.fetch ? { fetch: override.fetch } : {}),
    ...(override.unzip ? { unzip: override.unzip } : {}),
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
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
    signal?: AbortSignal,
  ): Promise<PetStoreQueryResult[]> {
    const reg = resolveCtx(ctx);
    const fetchFn = reg.fetch ?? fetch;
    const init: RequestInit = { redirect: 'follow' };
    if (signal) init.signal = signal;
    const catalogUrl = reg.registryUrl ?? DEFAULT_REGISTRY_URL;
    const response = await fetchFn(catalogUrl, init);
    if (!response.ok) {
      // CodexPetHub no longer ships a public catalog.json (often 404). Browse
      // is best-effort — surface a clear hint instead of a raw HTTP code.
      if (response.status === 404) {
        throw new Error(
          `registry catalog unavailable (${catalogUrl} → HTTP 404). Use “Install by ID” with a pet slug (e.g. guga) instead of browsing.`,
        );
      }
      throw new Error(`registry query failed: HTTP ${response.status} (${catalogUrl})`);
    }
    const entries = (await response.json()) as PetRegistryEntry[];
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
    signal?: AbortSignal,
  ): Promise<PetInstallResult> {
    const reg = resolveCtx(ctx);
    let trimmed = location.trim();

    // Accept bare slug or pasted CLI: `npx codex-pets add guga`, etc.
    if (!trimmed.startsWith('{') && !trimmed.includes('://')) {
      const parsed = parsePetInstallInput(trimmed);
      if (parsed.kind === 'error' && !isPetSlug(trimmed)) {
        throw new Error(parsed.message);
      }
      if (parsed.kind === 'slug') {
        trimmed = parsed.slug;
      }
    }

    // 1) Bare slug → try preferred registry, fall back to the other.
    if (isPetSlug(trimmed) && !trimmed.includes('://') && !trimmed.startsWith('{')) {
      const preferred = reg.preferredSlugRegistry ?? 'codexpethub';
      const tryOrder: Array<'codexpethub' | 'codex-pets-net'> =
        preferred === 'codex-pets-net'
          ? ['codex-pets-net', 'codexpethub']
          : ['codexpethub', 'codex-pets-net'];

      let lastErr: unknown = null;
      for (const registry of tryOrder) {
        try {
          if (registry === 'codexpethub') {
            const opts: InstallManifestOptions = {};
            if (reg.fetch) opts.fetch = reg.fetch;
            if (signal) opts.signal = signal;
            if (reg.registryOrigin) opts.registryOrigin = reg.registryOrigin;
            if (reg.allowedHosts) opts.allowedHosts = reg.allowedHosts;
            return await installPetFromSlug(ctx, trimmed, opts);
          }
          const opts: CodexPetsNetOptions = {};
          if (reg.fetch) opts.fetch = reg.fetch;
          if (signal) opts.signal = signal;
          if (reg.registryOrigin) opts.registryOrigin = reg.registryOrigin;
          if (reg.allowedHosts) opts.allowedHosts = reg.allowedHosts;
          if (reg.unzip) opts.unzip = reg.unzip;
          return await installPetFromCodexPetsNet(ctx, trimmed, opts);
        } catch (err) {
          // 404 / not-found → try next registry. Other errors (hash mismatch,
          // network) should surface immediately.
          const msg = err instanceof Error ? err.message : String(err);
          const isNotFound = /HTTP 404|not found|missing pet\.id|schema/i.test(msg);
          if (!isNotFound) throw err;
          lastErr = err;
        }
      }
      throw lastErr ?? new Error(
        `pet not found on codexpethub.com or codex-pets.net: ${trimmed}`,
      );
    }

    // 2) JSON-encoded catalog entry or bare package URL (legacy zip path).
    let entry: PetRegistryEntry;
    try {
      entry = JSON.parse(location) as PetRegistryEntry;
    } catch {
      // Bare URL — try catalog lookup; if that fails and it looks like a slug
      // we already handled above, so this is a real URL miss.
      if (isPetSlug(trimmed)) {
        // Try both registries; codexpethub first, then codex-pets.net.
        let lastErr: unknown = null;
        for (const registry of ['codexpethub', 'codex-pets-net'] as const) {
          try {
            if (registry === 'codexpethub') {
              const opts: InstallManifestOptions = {};
              if (reg.fetch) opts.fetch = reg.fetch;
              if (signal) opts.signal = signal;
              if (reg.registryOrigin) opts.registryOrigin = reg.registryOrigin;
              if (reg.allowedHosts) opts.allowedHosts = reg.allowedHosts;
              return await installPetFromSlug(ctx, trimmed, opts);
            }
            const opts: CodexPetsNetOptions = {};
            if (reg.fetch) opts.fetch = reg.fetch;
            if (signal) opts.signal = signal;
            if (reg.registryOrigin) opts.registryOrigin = reg.registryOrigin;
            if (reg.allowedHosts) opts.allowedHosts = reg.allowedHosts;
            if (reg.unzip) opts.unzip = reg.unzip;
            return await installPetFromCodexPetsNet(ctx, trimmed, opts);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/HTTP 404|not found|missing pet\.id|schema/i.test(msg)) throw err;
            lastErr = err;
          }
        }
        throw lastErr ?? new Error(`pet not found on any registry: ${trimmed}`);
      }
      const results = await registryProvider.queryStore!(ctx, '', signal);
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

    // JSON entry with only an id/slug and no usable zip url → slug install
    // (tries both registries).
    if (
      entry.id &&
      isPetSlug(entry.id) &&
      (!entry.url || !/^https:\/\//i.test(entry.url) || !entry.sha256)
    ) {
      let lastErr: unknown = null;
      for (const registry of ['codexpethub', 'codex-pets-net'] as const) {
        try {
          if (registry === 'codexpethub') {
            const opts: InstallManifestOptions = {};
            if (reg.fetch) opts.fetch = reg.fetch;
            if (signal) opts.signal = signal;
            if (reg.registryOrigin) opts.registryOrigin = reg.registryOrigin;
            if (reg.allowedHosts) opts.allowedHosts = reg.allowedHosts;
            return await installPetFromSlug(ctx, entry.id, opts);
          }
          const opts: CodexPetsNetOptions = {};
          if (reg.fetch) opts.fetch = reg.fetch;
          if (signal) opts.signal = signal;
          if (reg.registryOrigin) opts.registryOrigin = reg.registryOrigin;
          if (reg.allowedHosts) opts.allowedHosts = reg.allowedHosts;
          if (reg.unzip) opts.unzip = reg.unzip;
          return await installPetFromCodexPetsNet(ctx, entry.id, opts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/HTTP 404|not found|missing pet\.id|schema/i.test(msg)) throw err;
          lastErr = err;
        }
      }
      throw lastErr ?? new Error(`pet not found on any registry: ${entry.id}`);
    }

    // entry.id becomes a directory/file name on disk — reject anything that
    // could escape the staging or target dirs (e.g. `../`). Same rules as the
    // manifest id validation.
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(entry.id)) {
      throw new Error(`unsafe pet id: ${entry.id}`);
    }

    const staging = join(ctx.piwinRoot, 'pets', '.staging', entry.id);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const downloadOptions: DownloadOptions = reg.fetch ? { fetch: reg.fetch } : {};
    if (signal) downloadOptions.signal = signal;
    const downloaded = await downloadAndVerifyPackage(entry, staging, downloadOptions);

    // Abort check before the unzip step — a cancelled install should not
    // spawn a host process or touch the filesystem further.
    if (signal?.aborted) throw new Error('install aborted');

    // Extract via host `unzip` (Node has no stdlib zip; keeps pkg dep-free).
    // macOS/Linux ship unzip; Windows follow-up tracked separately.
    const unzipFn = reg.unzip ?? defaultUnzip;
    try {
      await unzipFn(downloaded.filePath, staging);
    } catch (err) {
      // Clean up staging so a failed extraction never leaves partial state.
      await rm(staging, { recursive: true, force: true });
      throw err;
    }

    // The downloaded zip lives inside staging; delete it before we scan the
    // directory so it can never leak into the installed pet dir (flat archives
    // keep petDir === staging, which would otherwise be renamed with the zip).
    await unlink(downloaded.filePath).catch(() => undefined);

    // Locate the extracted pet dir: a single top-level folder, else staging.
    let petDir = staging;
    const children = await readdir(staging);
    if (children.length === 1) {
      const candidate = join(staging, children[0]!);
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
      throw new Error(validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }

    // Atomic install: swap the staged dir into place. rename() cannot replace
    // a non-empty directory on POSIX, so move any existing install aside
    // first; if the swap fails we restore the previous install rather than
    // leaving a half-installed pet.
    const target = join(ctx.petsDir, validated.manifest.id);
    await mkdir(ctx.petsDir, { recursive: true });
    const backup = join(ctx.petsDir, `.trash-${validated.manifest.id}-${Date.now()}`);
    await rm(backup, { recursive: true, force: true });
    let previous = false;
    try {
      if (await pathExists(target)) {
        await rename(target, backup);
        previous = true;
      }
      await rename(petDir, target);
    } catch (err) {
      if (previous) await rename(backup, target).catch(() => undefined);
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    // Drop the backup and the (now-empty) staging root; rmdir fails harmlessly
    // if a concurrent install still has a pet staging under it.
    await rm(backup, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
    await rmdir(join(ctx.piwinRoot, 'pets', '.staging')).catch(() => undefined);
    return { petId: validated.manifest.id, source: 'registry', path: target };
  },
};
