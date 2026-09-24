/**
 * One interpreter for a clicked path (ADR 0052 §6).
 *
 * Historically the markdown layer, the chip layer, the Desktop open planner,
 * the alias retry, the tool-card target builder, the local-file reader and the
 * config reader each decided on their own what a path string meant. Every new
 * spelling had to be taught to all of them, and whichever one missed answered
 * `not-found` — which is how a `~/.piwin/pi-agent/auth.json` click ended up
 * looking for `<project>/~/.piwin/pi-agent/auth.json`.
 *
 * This module owns the *pure* part of the interpretation: normalizing the raw
 * text and deciding which logical route a path names. Filesystem facts
 * (realpath, existence, the bounded project search) are supplied by
 * `document-path-resolution.ts`; nothing here touches disk.
 */
import type { DocumentTargetRef, ResourceCatalogEntry } from '@piwin/contracts';
import {
  configStoreDisplayRef,
  configStoreRelativePath,
  normalizeResourceId,
} from '@piwin/contracts';

export type NormalizedDocumentPath =
  { ok: true; path: string } | { ok: false; reason: 'empty-path' | 'invalid-path' };

/**
 * Strip the `file://` scheme, decode percent escapes, and trim. A path that
 * cannot be decoded is rejected rather than passed on half-mangled: guessing
 * what a broken escape meant is how a wrong file gets opened.
 */
export function normalizeDocumentPathText(raw: string): NormalizedDocumentPath {
  const withoutScheme = (raw ?? '').replace(/^file:\/\//i, '').trim();
  if (!withoutScheme) {
    return { ok: false, reason: 'empty-path' };
  }
  let decoded = withoutScheme;
  if (withoutScheme.includes('%')) {
    try {
      decoded = decodeURIComponent(withoutScheme);
    } catch {
      return { ok: false, reason: 'invalid-path' };
    }
  }
  const trimmed = decoded.trim();
  if (!trimmed || trimmed.includes('\0')) {
    return { ok: false, reason: 'invalid-path' };
  }
  return { ok: true, path: trimmed };
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Expand a leading `~` / `~/` to the Host user's home; leave all else alone. */
export function expandHomePath(value: string, homeDir: string): string {
  if (value === '~') {
    return homeDir;
  }
  if (!/^~[\\/]/.test(value)) {
    return value;
  }
  const home = normalizeSlashes(homeDir).replace(/\/+$/, '');
  return `${home}/${normalizeSlashes(value.slice(2)).replace(/^\/+/, '')}`;
}

export function isAbsoluteDocumentPath(value: string): boolean {
  return (
    value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^~[\\/]/.test(value) || value === '~'
  );
}

/** `path` relative to `root`, or null when it is not under `root`. */
export function relativeUnder(root: string, path: string): string | null {
  const rootNorm = normalizeSlashes(root).replace(/\/+$/, '');
  const pathNorm = normalizeSlashes(path);
  if (!rootNorm) return null;
  const rootKey = rootNorm.toLowerCase();
  const pathKey = pathNorm.toLowerCase();
  if (pathKey === rootKey) return '';
  return pathKey.startsWith(`${rootKey}/`) ? pathNorm.slice(rootNorm.length + 1) : null;
}

/** Safe id segment for vault-derived session/asset ids (no traversal). */
const SAFE_VAULT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Logical media target for a `…/.piwin/media/<sessionId>/<assetId><ext>` vault
 * path, or for this Host's own media root. Returns null unless both segments
 * are safe ids — a host path is never forwarded onward.
 */
export function mediaTargetFromVaultPath(
  filePath: string,
  piwinRoot?: string | null,
): DocumentTargetRef | null {
  const normalized = normalizeSlashes(filePath);
  const rootRelative = piwinRoot
    ? relativeUnder(`${normalizeSlashes(piwinRoot).replace(/\/+$/, '')}/media`, normalized)
    : null;
  const conventional = normalized.match(/\/\.piwin(?:-[^/]+)?\/media\/(.+)$/);
  const rest = rootRelative !== null && rootRelative !== '' ? rootRelative : conventional?.[1];
  if (!rest) {
    return null;
  }
  const segments = rest.split('/');
  if (segments.length !== 2) {
    return null;
  }
  const sessionId = segments[0] ?? '';
  const fileName = segments[1] ?? '';
  const assetId = fileName.replace(/\.[a-zA-Z0-9]{1,12}$/, '');
  if (!SAFE_VAULT_SEGMENT.test(sessionId) || !SAFE_VAULT_SEGMENT.test(assetId)) {
    return null;
  }
  return { kind: 'media', sessionId, assetId, displayRef: fileName };
}

/**
 * Logical trusted-config target for a path under this Host's config root.
 * The media vault is not config text, and the root itself is not a file.
 */
export function trustedConfigTargetFromPath(
  filePath: string,
  piwinRoot: string | null | undefined,
  homeDir: string,
): DocumentTargetRef | null {
  const relative = configStoreRelativePath(filePath, piwinRoot, homeDir);
  if (!relative) {
    return null;
  }
  return {
    kind: 'trusted-config',
    relativePath: relative,
    displayRef: configStoreDisplayRef(piwinRoot, relative),
  };
}

/** Catalog-backed or path-shaped skill identity (`skill:<id>`). */
export function skillTargetFromPath(
  filePath: string,
  entries: readonly ResourceCatalogEntry[],
): DocumentTargetRef | null {
  const hit = matchSkillEntry(filePath, entries);
  if (hit) {
    const effectiveSource = hit.source === 'pi-native' ? undefined : hit.source;
    return {
      kind: 'skill',
      skillId: hit.resourceId,
      displayRef: `skill:${hit.resourceId}`,
      ...(effectiveSource !== undefined ? { effectiveSource } : {}),
    };
  }
  const skillIdFromPath = extractSkillIdFromPath(filePath);
  if (skillIdFromPath) {
    return { kind: 'skill', skillId: skillIdFromPath, displayRef: `skill:${skillIdFromPath}` };
  }
  return null;
}

export function matchSkillEntry(
  filePath: string,
  entries: readonly ResourceCatalogEntry[],
): ResourceCatalogEntry | null {
  const normalized = normalizeForCompare(filePath);
  for (const entry of entries) {
    if (entry.kind !== 'skill') continue;
    const skillPath = normalizeForCompare(entry.path);
    if (
      normalized === skillPath ||
      normalized === `${skillPath}/skill.md` ||
      normalized.startsWith(`${skillPath}/`)
    ) {
      return entry;
    }
  }
  // Match by extracted id when path is under a skills root.
  const extracted = extractSkillIdFromPath(filePath);
  if (!extracted) return null;
  for (const entry of entries) {
    if (entry.kind !== 'skill') continue;
    if (entry.resourceId === extracted || safeId(entry.name) === extracted) {
      return entry;
    }
  }
  return null;
}

export function extractSkillIdFromPath(filePath: string): string | null {
  const normalized = normalizeForCompare(filePath);
  const skillMd = normalized.match(/\/skills\/([^/]+)\/skill\.md$/);
  if (skillMd?.[1]) return safeId(skillMd[1]);
  const skillDir = normalized.match(/\/skills\/([^/]+)\/?$/);
  if (skillDir?.[1] && !skillDir[1].includes('.')) return safeId(skillDir[1]);
  if (/\/skill\.md$/.test(normalized)) {
    const parts = normalized.split('/').filter(Boolean);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (parent && parent !== 'skills') return safeId(parent);
  }
  return null;
}

function normalizeForCompare(value: string): string {
  return normalizeSlashes(value)
    .replace(/^file:\/\//i, '')
    .trim()
    .toLowerCase();
}

function safeId(value: string): string | null {
  try {
    return normalizeResourceId(value);
  } catch {
    return null;
  }
}
