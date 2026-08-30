/**
 * Vault listing for the unified Studio Library.
 *
 * Scans `mediaRoot/<sessionId>/` for generated image and video files,
 * newest first. User paste / drop / file-picker assets stay in the vault
 * for chat, but they do not appear here. Prompt/model come from the
 * `<assetId>.json` sidecar written on generate. JSON assets use
 * `<assetId>.meta.json` so the metadata file cannot overwrite the asset.
 * Listing never follows session-dir symlinks.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  MEDIA_LIST_DEFAULT_LIMIT,
  MEDIA_LIST_MAX_LIMIT,
  isMediaThumbFileName,
  type MediaLibraryItem,
  type MediaLibraryKind,
  type MediaLibraryMeta,
  type MediaListData,
  type MediaListInput,
} from '@piwin/contracts';
import { attachLibraryThumbs } from './media-thumb.js';
import { assertInsideMediaRoot, assertRealPathInsideMediaRoot } from './media-service.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
/** Common text/document extensions accepted by media/save. */
const FILE_EXT = new Set([
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.tsv',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.zsh',
  '.sql',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.svg',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.bin',
]);

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.jsx': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cc': 'text/x-c++',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.sh': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.sql': 'application/sql',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.bin': 'application/octet-stream',
};

export type ListMediaLibraryOptions = {
  mediaRoot: string;
};

export async function writeMediaLibraryMeta(
  options: ListMediaLibraryOptions,
  sessionId: string,
  assetId: string,
  meta: MediaLibraryMeta,
): Promise<void> {
  const sessionDir = resolve(options.mediaRoot, sanitizeSegment(sessionId));
  await assertRealPathInsideMediaRoot(options.mediaRoot, sessionDir);
  const safeAssetId = sanitizeSegment(assetId);
  const legacyPath = resolve(sessionDir, `${safeAssetId}.json`);
  const legacyEntry = await stat(legacyPath).catch(() => null);
  const siblings = await readdir(sessionDir).catch(() => [] as string[]);
  const hasNonJsonSibling = siblings.some(
    (fileName) =>
      fileName !== `${safeAssetId}.json` &&
      fileName.startsWith(`${safeAssetId}.`) &&
      !fileName.endsWith('.meta.json') &&
      !isMediaThumbFileName(fileName) &&
      extname(fileName).toLowerCase() !== '.json',
  );
  const sidecarPath =
    legacyEntry?.isFile() === true && !hasNonJsonSibling
      ? resolve(sessionDir, `${safeAssetId}.meta.json`)
      : legacyPath;
  assertInsideMediaRoot(options.mediaRoot, sidecarPath);
  await writeFile(sidecarPath, `${JSON.stringify(meta)}\n`, 'utf8');
}

export async function listMediaLibrary(
  options: ListMediaLibraryOptions,
  input: MediaListInput,
): Promise<MediaListData> {
  const kind = input.kind;
  const query = input.query?.trim().toLowerCase() ?? '';
  const limit = clampLimit(input.limit);
  const cursor = decodeCursor(input.cursor);
  const records = await scanVault(options.mediaRoot, kind);
  const filtered = query === '' ? records : records.filter((item) => matchesQuery(item, query));
  filtered.sort(compareNewestFirst);
  const start = cursor === null ? 0 : indexAfterCursor(filtered, cursor);
  const page = await attachLibraryThumbs(options, filtered.slice(start, start + limit));
  const data: MediaListData = {
    items: page,
    total: filtered.length,
  };
  const lastOnPage = page[page.length - 1];
  if (lastOnPage && filtered[start + limit]) {
    data.nextCursor = encodeCursor(lastOnPage);
  }
  return data;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isSafeInteger(limit)) {
    return MEDIA_LIST_DEFAULT_LIMIT;
  }
  return Math.min(MEDIA_LIST_MAX_LIMIT, Math.max(1, limit));
}

async function scanVault(
  mediaRoot: string,
  kind: MediaLibraryKind | undefined,
): Promise<MediaLibraryItem[]> {
  const root = resolve(mediaRoot);
  const sessionNames = await readdir(root).catch(() => null);
  if (sessionNames === null) {
    return [];
  }
  const items: MediaLibraryItem[] = [];
  for (const sessionName of sessionNames) {
    if (sessionName.startsWith('.')) {
      continue;
    }
    let sessionId: string;
    try {
      sessionId = sanitizeSegment(sessionName);
    } catch {
      continue;
    }
    const sessionDir = resolve(root, sessionId);
    try {
      assertInsideMediaRoot(root, sessionDir);
      await assertRealPathInsideMediaRoot(root, sessionDir);
    } catch {
      continue;
    }
    const sessionStat = await stat(sessionDir).catch(() => null);
    if (sessionStat === null || !sessionStat.isDirectory()) {
      continue;
    }
    const files = await readdir(sessionDir).catch(() => null);
    if (files === null) {
      continue;
    }
    const metaByAsset = await loadSidecars(root, sessionDir, files);
    for (const fileName of files) {
      const item = await describeVaultFile({
        root,
        sessionDir,
        sessionId,
        fileName,
        files,
        kind,
        metaByAsset,
      });
      if (item) {
        items.push(item);
      }
    }
  }
  return items;
}

async function loadSidecars(
  root: string,
  sessionDir: string,
  files: readonly string[],
): Promise<Map<string, MediaLibraryMeta>> {
  const metaByAsset = new Map<string, MediaLibraryMeta>();
  for (const fileName of files) {
    if (!isMediaLibrarySidecarName(fileName, files)) {
      continue;
    }
    const assetId = fileName.endsWith('.meta.json')
      ? fileName.slice(0, -'.meta.json'.length)
      : fileName.slice(0, -'.json'.length);
    if (!assetId) {
      continue;
    }
    const sidecarPath = resolve(sessionDir, fileName);
    try {
      assertInsideMediaRoot(root, sidecarPath);
    } catch {
      continue;
    }
    const raw = await readFile(sidecarPath, 'utf8').catch(() => null);
    if (raw === null) {
      continue;
    }
    const parsed = parseMeta(raw);
    if (parsed) {
      metaByAsset.set(assetId, parsed);
    }
  }
  return metaByAsset;
}

async function describeVaultFile(input: {
  root: string;
  sessionDir: string;
  sessionId: string;
  fileName: string;
  files: readonly string[];
  kind: MediaLibraryKind | undefined;
  metaByAsset: ReadonlyMap<string, MediaLibraryMeta>;
}): Promise<MediaLibraryItem | null> {
  if (
    isMediaThumbFileName(input.fileName) ||
    isMediaLibrarySidecarName(input.fileName, input.files)
  ) {
    return null;
  }
  const extension = extname(input.fileName).toLowerCase();
  const fileKind = kindForExtension(extension);
  if (fileKind === null || (input.kind !== undefined && fileKind !== input.kind)) {
    return null;
  }
  const assetId = input.fileName.slice(0, -extension.length);
  if (!assetId || assetId.startsWith('.')) {
    return null;
  }
  const absolutePath = resolve(input.sessionDir, input.fileName);
  try {
    assertInsideMediaRoot(input.root, absolutePath);
  } catch {
    return null;
  }
  const fileStat = await stat(absolutePath).catch(() => null);
  if (fileStat === null || !fileStat.isFile()) {
    return null;
  }
  const meta = input.metaByAsset.get(assetId);
  // ponytail: Library is generated output only; chat screenshots stay in the vault.
  if (meta?.source !== 'generated') {
    return null;
  }
  return {
    assetId,
    sessionId: input.sessionId,
    mimeType: EXT_TO_MIME[extension] ?? 'application/octet-stream',
    byteSize: fileStat.size,
    createdAt: meta?.createdAt || fileStat.mtime.toISOString(),
    kind: fileKind,
    absolutePath,
    ...(meta?.prompt ? { prompt: meta.prompt } : {}),
    ...(meta?.model ? { model: meta.model } : {}),
    ...(meta?.name ? { name: meta.name } : {}),
  };
}

function kindForExtension(extension: string): MediaLibraryKind | null {
  if (IMAGE_EXT.has(extension)) {
    return 'image';
  }
  if (VIDEO_EXT.has(extension)) {
    return 'video';
  }
  if (FILE_EXT.has(extension)) {
    return 'file';
  }
  return null;
}

function isMediaLibrarySidecarName(fileName: string, files: readonly string[]): boolean {
  if (fileName.endsWith('.meta.json')) {
    return true;
  }
  if (!fileName.endsWith('.json')) {
    return false;
  }
  const assetId = fileName.slice(0, -'.json'.length);
  if (!assetId) {
    return false;
  }
  return files.some((candidate) => {
    if (candidate === fileName || isMediaThumbFileName(candidate)) {
      return false;
    }
    return candidate.startsWith(`${assetId}.`) && extname(candidate).toLowerCase() !== '.json';
  });
}

function matchesQuery(item: MediaLibraryItem, query: string): boolean {
  return (
    item.name?.toLowerCase().includes(query) === true ||
    item.prompt?.toLowerCase().includes(query) === true ||
    item.model?.toLowerCase().includes(query) === true ||
    item.sessionId.toLowerCase().includes(query) ||
    item.assetId.toLowerCase().includes(query) ||
    item.mimeType.toLowerCase().includes(query)
  );
}

function compareNewestFirst(left: MediaLibraryItem, right: MediaLibraryItem): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }
  if (left.sessionId !== right.sessionId) {
    return left.sessionId.localeCompare(right.sessionId);
  }
  return left.assetId.localeCompare(right.assetId);
}

type ListCursor = {
  createdAt: string;
  sessionId: string;
  assetId: string;
};

function encodeCursor(item: MediaLibraryItem): string {
  return Buffer.from(`${item.createdAt}\t${item.sessionId}\t${item.assetId}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string | undefined): ListCursor | null {
  if (!cursor?.trim()) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, sessionId, assetId] = decoded.split('\t');
    if (!createdAt || !sessionId || !assetId) {
      return null;
    }
    return { createdAt, sessionId, assetId };
  } catch {
    return null;
  }
}

function indexAfterCursor(items: readonly MediaLibraryItem[], cursor: ListCursor): number {
  const index = items.findIndex(
    (item) =>
      item.createdAt === cursor.createdAt &&
      item.sessionId === cursor.sessionId &&
      item.assetId === cursor.assetId,
  );
  return index === -1 ? 0 : index + 1;
}

function parseMeta(raw: string): MediaLibraryMeta | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (
      (record.source !== 'generated' &&
        record.source !== 'paste' &&
        record.source !== 'drop' &&
        record.source !== 'file-picker') ||
      (record.kind !== 'image' && record.kind !== 'video' && record.kind !== 'file') ||
      typeof record.createdAt !== 'string'
    ) {
      return null;
    }
    const meta: MediaLibraryMeta = {
      source: record.source,
      kind: record.kind,
      createdAt: record.createdAt,
    };
    if (typeof record.name === 'string' && record.name.trim()) {
      meta.name = record.name.trim();
    }
    if (typeof record.prompt === 'string' && record.prompt.trim()) {
      meta.prompt = record.prompt;
    }
    if (typeof record.model === 'string' && record.model.trim()) {
      meta.model = record.model;
    }
    return meta;
  } catch {
    return null;
  }
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned) {
    throw new Error('invalid media path segment');
  }
  return cleaned;
}
