/**
 * CodexPetHub install-manifest install path (npx codexpethub install <slug>).
 *
 * Fetches:
 *   GET {registryOrigin}/api/v1/pets/{slug}/install-manifest.json
 * then downloads each allowed file (pet.json + spritesheet.webp) with per-file
 * SHA-256 verification into ~/.piwin/pets/<slug>/.
 *
 * This is the real CodexPetHub protocol — the old catalog.json zip path is
 * kept as a fallback for custom registries that still serve zip packages.
 */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { PetInstallResult } from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import { PET_MAX_DOWNLOAD_BYTES } from './registry-download.js';
import type { PetSourceProviderContext } from './pet-source-provider.js';

export const CODEXPETHUB_ORIGIN = 'https://codexpethub.com';
export const INSTALL_MANIFEST_SCHEMA = 'codexpethub.install.v1';

/** Safe pet slug: alphanumeric with -/_ , no path traversal. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** Hosts allowed for install-manifest + asset downloads. */
const ALLOWED_HOSTS = new Set([
  'codexpethub.com',
  'www.codexpethub.com',
  'assets.codexpethub.com',
]);

export type InstallManifestFile = {
  role: string;
  path: string;
  url: string;
  content_type?: string;
  size: number;
  sha256: string;
};

export type InstallManifest = {
  schema_version: string;
  pet: {
    id?: string;
    slug: string;
    display_name?: string;
    version?: number | string;
    description?: string;
  };
  files: InstallManifestFile[];
  security?: {
    allowed_install_files?: string[];
    verify_hashes_required?: boolean;
  };
};

export type InstallManifestOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Override registry origin (tests / staging). Default CodexPetHub. */
  registryOrigin?: string;
  /** Extra allowed HTTPS hosts for asset URLs (tests). */
  allowedHosts?: ReadonlySet<string>;
  maxBytes?: number;
};

export function isPetSlug(value: string): boolean {
  return SLUG_RE.test(value.trim());
}

function assertAllowedUrl(
  urlString: string,
  allowedHosts: ReadonlySet<string>,
): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`invalid install url: ${urlString}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`install url must be https: ${urlString}`);
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`install url host not allow-listed: ${url.hostname}`);
  }
  return url;
}

function safeRelativePath(path: string): string {
  const base = basename(path);
  if (!base || base === '.' || base === '..' || base.includes('\0')) {
    throw new Error(`unsafe install file path: ${path}`);
  }
  // Only allow flat package files (pet.json / spritesheet.webp).
  if (path.includes('/') || path.includes('\\')) {
    throw new Error(`install file must be package-root relative: ${path}`);
  }
  return base;
}

/**
 * Fetch + validate the CodexPetHub install-manifest for a slug.
 */
export async function fetchInstallManifest(
  slug: string,
  options: InstallManifestOptions = {},
): Promise<InstallManifest> {
  const trimmed = slug.trim();
  if (!isPetSlug(trimmed)) {
    throw new Error(`invalid pet slug: ${slug}`);
  }
  const origin = (options.registryOrigin ?? CODEXPETHUB_ORIGIN).replace(/\/$/, '');
  const allowedHosts = options.allowedHosts ?? ALLOWED_HOSTS;
  const manifestUrl = `${origin}/api/v1/pets/${encodeURIComponent(trimmed)}/install-manifest.json`;
  assertAllowedUrl(manifestUrl, allowedHosts);

  const fetchFn = options.fetch ?? fetch;
  const init: RequestInit = { redirect: 'follow' };
  if (options.signal) init.signal = options.signal;
  const response = await fetchFn(manifestUrl, init);
  if (!response.ok) {
    throw new Error(
      `install-manifest fetch failed for "${trimmed}": HTTP ${response.status}`,
    );
  }
  const raw = (await response.json()) as InstallManifest;
  if (raw.schema_version !== INSTALL_MANIFEST_SCHEMA) {
    throw new Error(
      `unsupported install-manifest schema: ${String(raw.schema_version)}`,
    );
  }
  if (!raw.pet?.slug || !Array.isArray(raw.files) || raw.files.length === 0) {
    throw new Error('install-manifest missing pet.slug or files');
  }
  return raw;
}

async function downloadVerifiedFile(
  file: InstallManifestFile,
  destPath: string,
  options: InstallManifestOptions,
  allowedHosts: ReadonlySet<string>,
): Promise<void> {
  assertAllowedUrl(file.url, allowedHosts);
  const maxBytes = options.maxBytes ?? PET_MAX_DOWNLOAD_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`file too large: ${file.path} (${file.size} > ${maxBytes})`);
  }

  const fetchFn = options.fetch ?? fetch;
  const init: RequestInit = { redirect: 'follow' };
  if (options.signal) init.signal = options.signal;
  const response = await fetchFn(file.url, init);
  if (!response.ok || !response.body) {
    throw new Error(`download failed for ${file.path}: HTTP ${response.status}`);
  }

  const tempPath = `${destPath}.tmp`;
  const handle = await open(tempPath, 'w');
  const hash = createHash('sha256');
  let total = 0;
  try {
    for await (const chunk of response.body as unknown as Iterable<Uint8Array>) {
      if (options.signal?.aborted) throw new Error('install aborted');
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new Error(`file exceeded size cap: ${file.path}`);
      }
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (total === 0) throw new Error(`empty file: ${file.path}`);
    const digest = hash.digest('hex');
    if (digest !== file.sha256.toLowerCase()) {
      throw new Error(
        `sha256 mismatch for ${file.path}: expected ${file.sha256}, got ${digest}`,
      );
    }
    // Optional WebP magic check for spritesheets.
    if (file.path.endsWith('.webp') || file.role === 'spritesheet') {
      // Re-read first 12 bytes from the temp file for RIFF....WEBP
      const head = await readFile(tempPath);
      if (
        head.byteLength < 12 ||
        head.subarray(0, 4).toString('ascii') !== 'RIFF' ||
        head.subarray(8, 12).toString('ascii') !== 'WEBP'
      ) {
        // PNG is also accepted by our renderer — allow PNG magic as fallback.
        const isPng =
          head.byteLength >= 8 &&
          head[0] === 0x89 &&
          head[1] === 0x50 &&
          head[2] === 0x4e &&
          head[3] === 0x47;
        if (!isPng) {
          throw new Error(`invalid spritesheet magic for ${file.path}`);
        }
      }
    }
  } catch (err) {
    await handle.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
  await handle.close();
  await rename(tempPath, destPath);
}

/**
 * Install a pet by CodexPetHub slug into ~/.piwin/pets/<slug>/.
 */
export async function installPetFromSlug(
  ctx: PetSourceProviderContext,
  slug: string,
  options: InstallManifestOptions = {},
): Promise<PetInstallResult> {
  const trimmed = slug.trim();
  if (!isPetSlug(trimmed)) {
    throw new Error(`invalid pet slug: ${slug}`);
  }

  const allowedHosts = options.allowedHosts ?? ALLOWED_HOSTS;
  const manifest = await fetchInstallManifest(trimmed, options);
  const petSlug = manifest.pet.slug;
  if (!isPetSlug(petSlug)) {
    throw new Error(`unsafe pet slug in manifest: ${petSlug}`);
  }

  const allowedFiles = new Set(
    manifest.security?.allowed_install_files ?? ['pet.json', 'spritesheet.webp'],
  );

  const staging = join(ctx.piwinRoot, 'pets', '.staging', petSlug);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    for (const file of manifest.files) {
      const rel = safeRelativePath(file.path);
      if (!allowedFiles.has(rel) && !allowedFiles.has(file.path)) {
        throw new Error(`install file not allowed: ${file.path}`);
      }
      await downloadVerifiedFile(file, join(staging, rel), options, allowedHosts);
    }

    // Validate pet.json after download. CodexPetHub packages use codexpet.v1
    // (name/atlas/states, no id/spritesheetPath) — fill from slug + package layout.
    const raw = await readFile(join(staging, 'pet.json'), 'utf8');
    const validated = validatePetManifest(JSON.parse(raw), {
      defaultId: petSlug,
      defaultSpritesheetPath: 'spritesheet.webp',
    });
    if (!validated.ok) {
      throw new Error(
        validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      );
    }

    // Prefer slug for install dir when the package id is a hub ULID-style token;
    // otherwise keep a safe manifest id.
    const packageId = validated.manifest.id;
    const petId =
      isPetSlug(petSlug) && (packageId.startsWith('pet_') || packageId.length > 40)
        ? petSlug
        : isPetSlug(packageId)
          ? packageId
          : petSlug;

    // Ensure spritesheet path exists (try declared path, then common Codex names).
    const sheetCandidates = [
      validated.manifest.spritesheetPath,
      'spritesheet.webp',
      'spritesheet.png',
    ];
    let resolvedSheet = validated.manifest.spritesheetPath;
    let sheetFound = false;
    for (const candidate of sheetCandidates) {
      try {
        await readFile(join(staging, candidate));
        resolvedSheet = candidate;
        sheetFound = true;
        break;
      } catch {
        // try next
      }
    }
    if (!sheetFound) {
      throw new Error(`missing spritesheet: ${validated.manifest.spritesheetPath}`);
    }

    // Always rewrite pet.json to the normalized piwin shape so local resolve works.
    const rewritten = {
      ...validated.manifest,
      id: petId,
      spritesheetPath: resolvedSheet,
    };
    await writeFile(join(staging, 'pet.json'), `${JSON.stringify(rewritten, null, 2)}\n`);

    const target = join(ctx.petsDir, petId);
    await mkdir(ctx.petsDir, { recursive: true });
    const backup = join(ctx.petsDir, `.trash-${petId}-${Date.now()}`);
    await rm(backup, { recursive: true, force: true });
    let previous = false;
    try {
      try {
        await readFile(join(target, 'pet.json'));
        await rename(target, backup);
        previous = true;
      } catch {
        // target does not exist
      }
      await rename(staging, target);
    } catch (err) {
      if (previous) await rename(backup, target).catch(() => undefined);
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    await rm(backup, { recursive: true, force: true });
    return { petId, source: 'registry', path: target };
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
