/**
 * codex-pets.net (codex-pet-share) install path.
 *
 * Protocol:
 *   GET {origin}/api/pets/{slug}            → pet detail JSON (display, downloadUrl)
 *   GET {origin}/api/pets/{slug}/download   → zip (pet.json + spritesheet.webp)
 *
 * Unlike CodexPetHub, this registry serves a single zip with no upfront
 * sha256. We trust-on-download with the same guards as `npx codex-pets add`:
 *   - HTTPS only
 *   - host allow-list (codex-pets.net)
 *   - ZIP magic bytes
 *   - size cap
 *   - pet.json validation post-extract
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { PetInstallResult } from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import { PET_MAX_DOWNLOAD_BYTES } from './registry-download.js';
import type { PetSourceProviderContext } from './pet-source-provider.js';

const execFileAsync = promisify(execFile);

export const CODEX_PETS_NET_ORIGIN = 'https://codex-pets.net';

const ALLOWED_HOSTS = new Set(['codex-pets.net', 'www.codex-pets.net']);

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type CodexPetsNetOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Override registry origin (tests / staging). Default codex-pets.net. */
  registryOrigin?: string;
  /** Extra allowed HTTPS hosts (tests). */
  allowedHosts?: ReadonlySet<string>;
  maxBytes?: number;
  /** Override host unzip (tests). */
  unzip?: (zipPath: string, destDir: string) => Promise<void>;
};

export type CodexPetsNetPetDetail = {
  pet: {
    id: string;
    displayName?: string;
    description?: string;
    spritesheetPath?: string;
  };
  downloadUrl?: string;
};

async function defaultUnzip(zipPath: string, destDir: string): Promise<void> {
  await execFileAsync('unzip', ['-o', zipPath, '-d', destDir]);
}

function assertAllowedUrl(urlString: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`invalid url: ${urlString}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`url must be https: ${urlString}`);
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`host not allow-listed: ${url.hostname}`);
  }
  return url;
}

/**
 * Fetch pet detail from codex-pets.net to resolve the download URL.
 */
export async function fetchCodexPetsNetDetail(
  slug: string,
  options: CodexPetsNetOptions = {},
): Promise<CodexPetsNetPetDetail> {
  const trimmed = slug.trim();
  if (!SLUG_RE.test(trimmed)) {
    throw new Error(`invalid pet slug: ${slug}`);
  }
  const origin = (options.registryOrigin ?? CODEX_PETS_NET_ORIGIN).replace(/\/$/, '');
  const allowedHosts = options.allowedHosts ?? ALLOWED_HOSTS;
  const detailUrl = `${origin}/api/pets/${encodeURIComponent(trimmed)}`;
  assertAllowedUrl(detailUrl, allowedHosts);

  const fetchFn = options.fetch ?? fetch;
  const init: RequestInit = { redirect: 'follow' };
  if (options.signal) init.signal = options.signal;
  const response = await fetchFn(detailUrl, init);
  if (!response.ok) {
    throw new Error(`codex-pets.net detail fetch failed for "${trimmed}": HTTP ${response.status}`);
  }
  const raw = (await response.json()) as CodexPetsNetPetDetail;
  if (!raw?.pet?.id) {
    throw new Error('codex-pets.net detail missing pet.id');
  }
  return raw;
}

/**
 * Download a zip from a codex-pets.net download URL into destDir.
 * No sha256 is published by this registry — we verify magic + size only,
 * then validate pet.json post-extract (same trust model as npx codex-pets add).
 * Returns the computed sha256 so callers can record it for diagnostics.
 */
async function downloadZipTrusted(
  downloadUrl: string,
  destDir: string,
  options: CodexPetsNetOptions,
  allowedHosts: ReadonlySet<string>,
): Promise<{ filePath: string; sizeBytes: number; sha256: string }> {
  // assertAllowedUrl validates https + host allow-list.
  assertAllowedUrl(downloadUrl, allowedHosts);

  const maxBytes = options.maxBytes ?? PET_MAX_DOWNLOAD_BYTES;
  const fetchFn = options.fetch ?? fetch;
  const init: RequestInit = { redirect: 'follow' };
  if (options.signal) init.signal = options.signal;
  const response = await fetchFn(downloadUrl, init);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }

  const tempPath = join(destDir, 'package.codex-pet.zip.tmp');
  const finalPath = join(destDir, 'package.codex-pet.zip');
  const handle = await open(tempPath, 'w');
  const hash = createHash('sha256');
  let total = 0;
  let firstChunk = true;
  try {
    for await (const chunk of response.body as unknown as Iterable<Uint8Array>) {
      if (options.signal?.aborted) throw new Error('install aborted');
      if (firstChunk) {
        firstChunk = false;
        if (
          chunk.byteLength < 4 ||
          !ZIP_MAGIC.equals(Buffer.from(chunk.buffer, chunk.byteOffset, 4))
        ) {
          throw new Error('invalid package: missing ZIP magic bytes');
        }
      }
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new Error(`package exceeded size cap: ${total} > ${maxBytes}`);
      }
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (total === 0) throw new Error('empty package');
  } catch (err) {
    await handle.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
  await handle.close();
  await rename(tempPath, finalPath);
  return { filePath: finalPath, sizeBytes: total, sha256: hash.digest('hex') };
}

/**
 * Install a pet from codex-pets.net by slug into ~/.piwin/pets/<slug>/.
 */
export async function installPetFromCodexPetsNet(
  ctx: PetSourceProviderContext,
  slug: string,
  options: CodexPetsNetOptions = {},
): Promise<PetInstallResult> {
  const trimmed = slug.trim();
  if (!SLUG_RE.test(trimmed)) {
    throw new Error(`invalid pet slug: ${slug}`);
  }

  const allowedHosts = options.allowedHosts ?? ALLOWED_HOSTS;
  const origin = (options.registryOrigin ?? CODEX_PETS_NET_ORIGIN).replace(/\/$/, '');
  const detail = await fetchCodexPetsNetDetail(trimmed, options);
  const petId = detail.pet.id.trim();
  if (!SLUG_RE.test(petId)) {
    throw new Error(`unsafe pet id from registry: ${petId}`);
  }

  // Resolve download URL: detail.downloadUrl is usually relative ("/api/...").
  const relativeDownload = detail.downloadUrl?.trim();
  if (!relativeDownload) {
    throw new Error(`codex-pets.net detail missing downloadUrl for "${trimmed}"`);
  }
  let downloadUrl: string;
  if (relativeDownload.startsWith('https://')) {
    downloadUrl = relativeDownload;
  } else if (relativeDownload.startsWith('http://')) {
    // Registry must serve over HTTPS — reject plain HTTP explicitly.
    throw new Error(`download url must be https: ${relativeDownload}`);
  } else if (relativeDownload.startsWith('/')) {
    downloadUrl = `${origin}${relativeDownload}`;
  } else {
    downloadUrl = `${origin}/${relativeDownload}`;
  }

  const staging = join(ctx.piwinRoot, 'pets', '.staging', petId);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const downloaded = await downloadZipTrusted(downloadUrl, staging, options, allowedHosts);

    if (options.signal?.aborted) throw new Error('install aborted');

    // Extract via host unzip.
    const unzipFn = options.unzip ?? defaultUnzip;
    try {
      await unzipFn(downloaded.filePath, staging);
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    // Drop the zip before scanning so it can't leak into the install dir.
    await unlink(downloaded.filePath).catch(() => undefined);

    // Locate pet dir: single top-level folder, else staging.
    let petDir = staging;
    const children = await readdir(staging);
    if (children.length === 1) {
      const candidate = join(staging, children[0]!);
      try {
        if ((await stat(candidate)).isDirectory()) petDir = candidate;
      } catch {
        // keep staging
      }
    }

    // Validate pet.json.
    const raw = await readFile(join(petDir, 'pet.json'), 'utf8');
    const validated = validatePetManifest(JSON.parse(raw));
    if (!validated.ok) {
      throw new Error(validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }

    const finalPetId = SLUG_RE.test(validated.manifest.id) ? validated.manifest.id : petId;

    // Ensure spritesheet exists.
    const sheet = join(petDir, validated.manifest.spritesheetPath);
    try {
      await readFile(sheet);
    } catch {
      throw new Error(`missing spritesheet: ${validated.manifest.spritesheetPath}`);
    }

    if (validated.manifest.id !== finalPetId) {
      const rewritten = { ...validated.manifest, id: finalPetId };
      await writeFile(join(petDir, 'pet.json'), `${JSON.stringify(rewritten, null, 2)}\n`);
    }

    const target = join(ctx.petsDir, finalPetId);
    await mkdir(ctx.petsDir, { recursive: true });
    const backup = join(ctx.petsDir, `.trash-${finalPetId}-${Date.now()}`);
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
      await rename(petDir, target);
    } catch (err) {
      if (previous) await rename(backup, target).catch(() => undefined);
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    await rm(backup, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
    return { petId: finalPetId, source: 'registry', path: target };
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}

/** Heuristic: does this slug look like it should try codex-pets.net? */
export function looksLikeCodexPetsNetSlug(slug: string): boolean {
  return SLUG_RE.test(slug.trim());
}
