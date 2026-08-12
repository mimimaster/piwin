/**
 * Non-destructive one-session pack create / verify / list (Cold Storage R1 PR1).
 *
 * Pack layout:
 *   piwin-pack/manifest.json
 *   piwin-pack/transcript/transcript.sqlite3
 *   piwin-pack/media/**            (only when the session has media files)
 *
 * Sibling sidecar:
 *   <pack>.piwin-pack.sha256       (whole-archive sha256 hex + filename)
 *
 * This module never mutates the source session payload. Callers that need a
 * durable SQLite snapshot must close writers and checkpoint WAL before packing.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import type {
  SessionIndexRecord,
  SessionPackCreateResultData,
  SessionPackListData,
  SessionPackListItem,
  SessionPackManifestV1,
  SessionPackVerifyResultData,
} from '@piwin/contracts';
import {
  PIWIN_SESSION_PACK_FORMAT,
  PIWIN_SESSION_PACK_SIDECAR_SUFFIX,
  PIWIN_SESSION_PACK_SUFFIX,
  PIWIN_SESSION_PACK_VERSION,
  assertSafeSessionPackId,
  assertSafeSessionPackSessionId,
} from '@piwin/contracts';
import { ZipFile } from 'yazl';
import yauzl from 'yauzl';
import { writeTextFileAtomic } from './atomic-text-file.js';

export const SESSION_PACK_MANIFEST_ENTRY = 'piwin-pack/manifest.json';
export const SESSION_PACK_TRANSCRIPT_ENTRY = 'piwin-pack/transcript/transcript.sqlite3';
export const SESSION_PACK_MEDIA_PREFIX = 'piwin-pack/media/';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PACK_ENTRIES = 50_000;

export type SessionPackPaths = {
  /** Absolute path of the session transcript.sqlite3 file. */
  transcriptPath: string;
  /** Absolute path of media/<sessionId>/ (may be absent). */
  mediaDir: string;
  /** Staging root under the Host (never the publish authority for PR1). */
  stagingDir: string;
};

export type CreateSessionPackInput = {
  record: SessionIndexRecord;
  paths: SessionPackPaths;
  /** Host-absolute external publish directory. */
  outputDir: string;
  /** Optional caller-supplied pack id (must already be safe). */
  packId?: string;
  /** Injected clock for tests. */
  now?: Date;
};

export type VerifySessionPackInput = {
  packPath: string;
};

export type ListSessionPacksInput = {
  directory: string;
};

type MediaTreeSummary = {
  included: true;
  files: Array<{ absolutePath: string; relativePath: string; byteLength: number; sha256: string }>;
  byteLength: number;
  fileCount: number;
  treeSha256: string;
} | {
  included: false;
  files: [];
  byteLength: 0;
  fileCount: 0;
};

/**
 * Checkpoint + truncate WAL so transcript.sqlite3 alone is a portable snapshot.
 * Must only run after all writers for this database are closed.
 */
export async function checkpointTranscriptWal(dbPath: string): Promise<void> {
  const stats = await stat(dbPath);
  if (!stats.isFile()) {
    throw new Error(`Transcript database is not a regular file: ${dbPath}`);
  }
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE);').get() as
      | { busy: number; log: number; checkpointed: number }
      | undefined;
    if (!row || row.busy !== 0 || row.log !== 0 || row.checkpointed < 0) {
      throw new Error(
        `WAL checkpoint did not fully truncate for ${dbPath}; refusing to pack an open database`,
      );
    }
  } finally {
    db.close();
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

export async function sha256Tree(files: Array<{ relativePath: string; sha256: string }>): Promise<string> {
  const hash = createHash('sha256');
  const ordered = [...files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  for (const file of ordered) {
    hash.update(`${file.relativePath}:${file.sha256}\n`);
  }
  return hash.digest('hex');
}

export function generateSessionPackId(sessionId: string, now: Date = new Date()): string {
  assertSafeSessionPackSessionId(sessionId);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const suffix = randomBytes(4).toString('hex');
  return assertSafeSessionPackId(`ses_${sessionId}-${stamp}-${suffix}`);
}

export async function createSessionPack(
  input: CreateSessionPackInput,
): Promise<SessionPackCreateResultData> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const sessionId = assertSafeSessionPackSessionId(input.record.id);
  const packId = assertSafeSessionPackId(input.packId ?? generateSessionPackId(sessionId, now));
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  await assertWritableDirectory(outputDir);

  const transcriptPath = resolve(input.paths.transcriptPath);
  if (!(await pathExists(transcriptPath))) {
    throw new Error(`Transcript database missing for session ${sessionId}: ${transcriptPath}`);
  }
  await checkpointTranscriptWal(transcriptPath);
  const transcriptSha256 = await sha256File(transcriptPath);
  const transcriptStats = await stat(transcriptPath);
  if (!transcriptStats.isFile() || transcriptStats.size <= 0) {
    throw new Error(`Transcript database is empty or not a file: ${transcriptPath}`);
  }

  // Open read-only for integrity + identity checks on the source snapshot.
  const messageCount = inspectTranscriptDatabase(transcriptPath, sessionId);
  const media = await collectMediaTree(input.paths.mediaDir);

  const manifest: SessionPackManifestV1 = {
    format: PIWIN_SESSION_PACK_FORMAT,
    version: PIWIN_SESSION_PACK_VERSION,
    packId,
    createdAt,
    session: {
      id: sessionId,
      projectPath: input.record.projectPath,
      createdAt: input.record.createdAt,
      updatedAt: input.record.updatedAt,
      messageCount,
      ...(input.record.name ? { name: input.record.name } : {}),
      ...(input.record.scope ? { scope: input.record.scope } : {}),
      ...(input.record.workingDirectory
        ? { workingDirectory: input.record.workingDirectory }
        : {}),
      ...(input.record.archivedAt ? { archivedAt: input.record.archivedAt } : {}),
      ...(input.record.lastPreview ? { lastPreview: input.record.lastPreview } : {}),
      ...(input.record.isPinned === true ? { isPinned: true } : {}),
      ...(input.record.kind ? { kind: input.record.kind } : {}),
    },
    transcript: {
      entryPath: SESSION_PACK_TRANSCRIPT_ENTRY,
      byteLength: transcriptStats.size,
      sha256: transcriptSha256,
      messageCount,
    },
    media: media.included
      ? {
          included: true,
          entryPrefix: SESSION_PACK_MEDIA_PREFIX,
          byteLength: media.byteLength,
          fileCount: media.fileCount,
          treeSha256: media.treeSha256,
        }
      : { included: false, byteLength: 0, fileCount: 0 },
  };

  const stagingRoot = join(input.paths.stagingDir, packId);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  const stagedPackPath = join(stagingRoot, `${packId}${PIWIN_SESSION_PACK_SUFFIX}`);
  const stagedSidecarPath = `${stagedPackPath}${PIWIN_SESSION_PACK_SIDECAR_SUFFIX}`;

  try {
    await writeZipArchive({
      packPath: stagedPackPath,
      manifest,
      transcriptPath,
      media,
    });
    const archiveSha256 = await sha256File(stagedPackPath);
    await writeTextFileAtomic(
      stagedSidecarPath,
      formatSidecar(archiveSha256, `${packId}${PIWIN_SESSION_PACK_SUFFIX}`),
    );

    // Publish via unique temp names then rename so readers never see a partial pack.
    const publishPackPath = join(outputDir, `${packId}${PIWIN_SESSION_PACK_SUFFIX}`);
    const publishSidecarPath = `${publishPackPath}${PIWIN_SESSION_PACK_SIDECAR_SUFFIX}`;
    if (await pathExists(publishPackPath) || await pathExists(publishSidecarPath)) {
      throw new Error(`Pack already exists in output directory: ${publishPackPath}`);
    }
    const tempPublishPackPath = `${publishPackPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    const tempPublishSidecarPath = `${publishSidecarPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await copyFile(stagedPackPath, tempPublishPackPath);
      await copyFile(stagedSidecarPath, tempPublishSidecarPath);
      await rename(tempPublishPackPath, publishPackPath);
      await rename(tempPublishSidecarPath, publishSidecarPath);
    } catch (error) {
      await rm(tempPublishPackPath, { force: true });
      await rm(tempPublishSidecarPath, { force: true });
      await rm(publishPackPath, { force: true });
      await rm(publishSidecarPath, { force: true });
      throw error;
    }

    // Re-verify the published authority, not just the staged copy.
    const verified = await verifySessionPack({ packPath: publishPackPath });
    if (verified.archiveSha256 !== archiveSha256) {
      throw new Error(`Published pack hash mismatch for ${publishPackPath}`);
    }

    const result: SessionPackCreateResultData = {
      packId,
      packPath: publishPackPath,
      sidecarPath: publishSidecarPath,
      sessionId,
      archiveSha256,
      transcriptSha256,
      payloadBytes: transcriptStats.size + media.byteLength,
      mediaIncluded: media.included,
      createdAt,
    };
    if (media.included) {
      result.mediaTreeSha256 = media.treeSha256;
    }
    return result;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function verifySessionPack(
  input: VerifySessionPackInput,
): Promise<SessionPackVerifyResultData> {
  const packPath = resolve(input.packPath);
  if (!packPath.endsWith(PIWIN_SESSION_PACK_SUFFIX)) {
    throw new Error(`Pack path must end with ${PIWIN_SESSION_PACK_SUFFIX}: ${packPath}`);
  }
  const sidecarPath = `${packPath}${PIWIN_SESSION_PACK_SIDECAR_SUFFIX}`;
  if (!(await pathExists(packPath))) {
    throw new Error(`Pack not found: ${packPath}`);
  }
  if (!(await pathExists(sidecarPath))) {
    throw new Error(`Pack sidecar not found: ${sidecarPath}`);
  }

  const archiveSha256 = await sha256File(packPath);
  const expected = await readSidecarSha256(sidecarPath, basename(packPath));
  if (archiveSha256 !== expected) {
    throw new Error(`Pack archive hash mismatch for ${packPath}`);
  }

  const entries = await readZipEntries(packPath);
  validateZipEntries(entries.map((entry) => entry.fileName));

  const manifestEntry = entries.find((entry) => entry.fileName === SESSION_PACK_MANIFEST_ENTRY);
  if (!manifestEntry) {
    throw new Error(`Pack missing manifest entry: ${SESSION_PACK_MANIFEST_ENTRY}`);
  }
  if (manifestEntry.uncompressedSize > MAX_MANIFEST_BYTES) {
    throw new Error(`Pack manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  }
  const manifestRaw = await readZipEntryBuffer(packPath, SESSION_PACK_MANIFEST_ENTRY);
  const manifest = parseSessionPackManifest(manifestRaw.toString('utf8'));
  assertSafeSessionPackId(manifest.packId);
  assertSafeSessionPackSessionId(manifest.session.id);

  const transcriptEntry = entries.find((entry) => entry.fileName === SESSION_PACK_TRANSCRIPT_ENTRY);
  if (!transcriptEntry) {
    throw new Error(`Pack missing transcript entry: ${SESSION_PACK_TRANSCRIPT_ENTRY}`);
  }
  if (transcriptEntry.uncompressedSize !== manifest.transcript.byteLength) {
    throw new Error('Pack transcript size does not match manifest');
  }

  const extractRoot = join(
    dirname(packPath),
    `.piwin-pack-verify-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  await mkdir(extractRoot, { recursive: true });
  try {
    await extractZipEntry(packPath, SESSION_PACK_TRANSCRIPT_ENTRY, join(extractRoot, 'transcript.sqlite3'));
    const transcriptSha256 = await sha256File(join(extractRoot, 'transcript.sqlite3'));
    if (transcriptSha256 !== manifest.transcript.sha256) {
      throw new Error('Pack transcript hash does not match manifest');
    }
    const messageCount = inspectTranscriptDatabase(
      join(extractRoot, 'transcript.sqlite3'),
      manifest.session.id,
    );
    if (messageCount !== manifest.transcript.messageCount) {
      throw new Error('Pack transcript message count does not match manifest');
    }

    if (manifest.media.included) {
      const mediaFiles = entries.filter(
        (entry) =>
          entry.fileName.startsWith(SESSION_PACK_MEDIA_PREFIX) &&
          !entry.fileName.endsWith('/'),
      );
      if (mediaFiles.length !== manifest.media.fileCount) {
        throw new Error('Pack media file count does not match manifest');
      }
      const mediaRoot = join(extractRoot, 'media');
      await mkdir(mediaRoot, { recursive: true });
      const hashed: Array<{ relativePath: string; sha256: string; byteLength: number }> = [];
      for (const entry of mediaFiles) {
        const relativePath = entry.fileName.slice(SESSION_PACK_MEDIA_PREFIX.length);
        if (!relativePath || relativePath.includes('..') || relativePath.startsWith('/')) {
          throw new Error(`Unsafe media entry path: ${entry.fileName}`);
        }
        const destination = join(mediaRoot, relativePath);
        await mkdir(dirname(destination), { recursive: true });
        await extractZipEntry(packPath, entry.fileName, destination);
        const digest = await sha256File(destination);
        const stats = await stat(destination);
        hashed.push({ relativePath: relativePath.split(sep).join('/'), sha256: digest, byteLength: stats.size });
      }
      const treeSha256 = await sha256Tree(hashed);
      if (treeSha256 !== manifest.media.treeSha256) {
        throw new Error('Pack media tree hash does not match manifest');
      }
      const totalBytes = hashed.reduce((sum, item) => sum + item.byteLength, 0);
      if (totalBytes !== manifest.media.byteLength) {
        throw new Error('Pack media byte length does not match manifest');
      }
    } else {
      const unexpectedMedia = entries.some((entry) => entry.fileName.startsWith(SESSION_PACK_MEDIA_PREFIX));
      if (unexpectedMedia) {
        throw new Error('Pack declares media.included=false but contains media entries');
      }
    }

    const payloadBytes =
      manifest.transcript.byteLength + (manifest.media.included ? manifest.media.byteLength : 0);
    const result: SessionPackVerifyResultData = {
      packPath,
      sidecarPath,
      packId: manifest.packId,
      sessionId: manifest.session.id,
      archiveSha256,
      transcriptSha256: manifest.transcript.sha256,
      payloadBytes,
      mediaIncluded: manifest.media.included,
      messageCount: manifest.transcript.messageCount,
      valid: true,
    };
    if (manifest.media.included) {
      result.mediaTreeSha256 = manifest.media.treeSha256;
    }
    return result;
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

export async function listSessionPacks(
  input: ListSessionPacksInput,
): Promise<SessionPackListData> {
  const directory = resolve(input.directory);
  if (!(await pathExists(directory))) {
    return { directory, packs: [] };
  }
  const stats = await stat(directory);
  if (!stats.isDirectory()) {
    throw new Error(`Pack list path is not a directory: ${directory}`);
  }
  const names = await readdir(directory);
  const packs: SessionPackListItem[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(PIWIN_SESSION_PACK_SUFFIX)) {
      continue;
    }
    const packPath = join(directory, name);
    const sidecarPath = `${packPath}${PIWIN_SESSION_PACK_SIDECAR_SUFFIX}`;
    try {
      const verified = await verifySessionPack({ packPath });
      packs.push({
        packId: verified.packId,
        packPath: verified.packPath,
        sidecarPath: verified.sidecarPath,
        sessionId: verified.sessionId,
        payloadBytes: verified.payloadBytes,
        mediaIncluded: verified.mediaIncluded,
        messageCount: verified.messageCount,
        createdAt: (await readPackCreatedAt(packPath)) ?? '',
        valid: true,
      });
    } catch (error) {
      packs.push({
        packId: name.slice(0, -PIWIN_SESSION_PACK_SUFFIX.length),
        packPath,
        sidecarPath,
        sessionId: '',
        payloadBytes: 0,
        mediaIncluded: false,
        messageCount: 0,
        createdAt: '',
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { directory, packs };
}

export function parseSessionPackManifest(raw: string): SessionPackManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Pack manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Pack manifest must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== PIWIN_SESSION_PACK_FORMAT) {
    throw new Error(`Unsupported pack format: ${String(record.format)}`);
  }
  if (record.version !== PIWIN_SESSION_PACK_VERSION) {
    throw new Error(`Unsupported pack version: ${String(record.version)}`);
  }
  if (typeof record.packId !== 'string' || typeof record.createdAt !== 'string') {
    throw new Error('Pack manifest missing packId/createdAt');
  }
  if (!record.session || typeof record.session !== 'object') {
    throw new Error('Pack manifest missing session metadata');
  }
  if (!record.transcript || typeof record.transcript !== 'object') {
    throw new Error('Pack manifest missing transcript metadata');
  }
  if (!record.media || typeof record.media !== 'object') {
    throw new Error('Pack manifest missing media metadata');
  }
  return parsed as SessionPackManifestV1;
}

function inspectTranscriptDatabase(dbPath: string, sessionId: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    try {
      const integrity = db.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string };
      const value = integrity?.integrity_check ?? '';
      if (value !== 'ok') {
        throw new Error(`SQLite integrity_check failed for ${dbPath}: ${value}`);
      }
    } catch (error) {
      // integrity_check may return a single row object or throw on severe corruption.
      if (error instanceof Error && error.message.includes('integrity_check failed')) {
        throw error;
      }
    }
    const meta = db
      .prepare('SELECT session_id FROM transcript_meta WHERE session_id = ?')
      .get(sessionId) as { session_id?: string } | undefined;
    if (meta?.session_id !== sessionId) {
      // Legacy or partially migrated DBs may only have messages; still require table presence.
      const table = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transcript_message'`,
        )
        .get() as { name?: string } | undefined;
      if (table?.name !== 'transcript_message') {
        throw new Error(`Transcript database missing transcript_message table: ${dbPath}`);
      }
    }
    const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
      count: number;
    };
    return row.count;
  } finally {
    db.close();
  }
}

async function collectMediaTree(mediaDir: string): Promise<MediaTreeSummary> {
  if (!(await pathExists(mediaDir))) {
    return { included: false, files: [], byteLength: 0, fileCount: 0 };
  }
  const rootStats = await stat(mediaDir);
  if (!rootStats.isDirectory()) {
    throw new Error(`Media path is not a directory: ${mediaDir}`);
  }
  const files: Array<{ absolutePath: string; relativePath: string; byteLength: number; sha256: string }> = [];
  await walkFiles(mediaDir, mediaDir, files);
  if (files.length === 0) {
    return { included: false, files: [], byteLength: 0, fileCount: 0 };
  }
  const treeSha256 = await sha256Tree(files);
  const byteLength = files.reduce((sum, file) => sum + file.byteLength, 0);
  return {
    included: true,
    files,
    byteLength,
    fileCount: files.length,
    treeSha256,
  };
}

async function walkFiles(
  rootDir: string,
  currentDir: string,
  files: Array<{ absolutePath: string; relativePath: string; byteLength: number; sha256: string }>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(rootDir, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Refusing to pack non-regular media entry: ${absolutePath}`);
    }
    const relativePath = relative(rootDir, absolutePath).split(sep).join('/');
    if (relativePath.includes('..')) {
      throw new Error(`Unsafe media relative path: ${relativePath}`);
    }
    const digest = await sha256File(absolutePath);
    const stats = await stat(absolutePath);
    files.push({
      absolutePath,
      relativePath,
      byteLength: stats.size,
      sha256: digest,
    });
  }
}

async function writeZipArchive(input: {
  packPath: string;
  manifest: SessionPackManifestV1;
  transcriptPath: string;
  media: MediaTreeSummary;
}): Promise<void> {
  await mkdir(dirname(input.packPath), { recursive: true });
  const zip = new ZipFile();
  const output = createWriteStream(input.packPath);
  const finished = new Promise<void>((resolvePromise, rejectPromise) => {
    output.on('close', () => resolvePromise());
    output.on('error', rejectPromise);
    zip.outputStream.on('error', rejectPromise);
  });
  zip.outputStream.pipe(output);

  const manifestBuffer = Buffer.from(`${JSON.stringify(input.manifest, null, 2)}\n`, 'utf8');
  zip.addBuffer(manifestBuffer, SESSION_PACK_MANIFEST_ENTRY);
  zip.addFile(input.transcriptPath, SESSION_PACK_TRANSCRIPT_ENTRY);
  if (input.media.included) {
    for (const file of input.media.files) {
      zip.addFile(file.absolutePath, `${SESSION_PACK_MEDIA_PREFIX}${file.relativePath}`);
    }
  }
  zip.end();
  await finished;
}

type ZipListEntry = {
  fileName: string;
  uncompressedSize: number;
  isDirectory: boolean;
};

function validateZipEntries(fileNames: string[]): void {
  if (fileNames.length === 0) {
    throw new Error('Pack archive is empty');
  }
  if (fileNames.length > MAX_PACK_ENTRIES) {
    throw new Error(`Pack has too many entries (${fileNames.length})`);
  }
  const seen = new Set<string>();
  for (const fileName of fileNames) {
    if (seen.has(fileName)) {
      throw new Error(`Pack contains duplicate entry: ${fileName}`);
    }
    seen.add(fileName);
    if (fileName.includes('\\') || fileName.includes('\0')) {
      throw new Error(`Pack contains unsafe entry path: ${fileName}`);
    }
    if (fileName.startsWith('/') || fileName.includes('..')) {
      throw new Error(`Pack entry escapes archive root: ${fileName}`);
    }
    if (
      fileName !== SESSION_PACK_MANIFEST_ENTRY &&
      fileName !== SESSION_PACK_TRANSCRIPT_ENTRY &&
      !fileName.startsWith(SESSION_PACK_MEDIA_PREFIX) &&
      fileName !== 'piwin-pack/' &&
      fileName !== 'piwin-pack/transcript/' &&
      fileName !== 'piwin-pack/media/'
    ) {
      // Allow directory placeholders written by some zip writers.
      if (!fileName.endsWith('/')) {
        throw new Error(`Pack entry outside allowed layout: ${fileName}`);
      }
      if (!fileName.startsWith('piwin-pack/')) {
        throw new Error(`Pack directory entry outside piwin-pack/: ${fileName}`);
      }
    }
  }
  if (!seen.has(SESSION_PACK_MANIFEST_ENTRY)) {
    throw new Error(`Pack missing ${SESSION_PACK_MANIFEST_ENTRY}`);
  }
  if (!seen.has(SESSION_PACK_TRANSCRIPT_ENTRY)) {
    throw new Error(`Pack missing ${SESSION_PACK_TRANSCRIPT_ENTRY}`);
  }
}

async function readZipEntries(packPath: string): Promise<ZipListEntry[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(packPath, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error(`Unable to open pack: ${packPath}`));
        return;
      }
      const entries: ZipListEntry[] = [];
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        entries.push({
          fileName: entry.fileName,
          uncompressedSize: entry.uncompressedSize,
          isDirectory: /\/$/.test(entry.fileName),
        });
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolvePromise(entries));
      zipFile.on('error', rejectPromise);
    });
  });
}

async function readZipEntryBuffer(packPath: string, entryName: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(packPath, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error(`Unable to open pack: ${packPath}`));
        return;
      }
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (entry.fileName !== entryName) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            rejectPromise(streamError ?? new Error(`Unable to read entry ${entryName}`));
            return;
          }
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          readStream.on('end', () => {
            zipFile.close();
            resolvePromise(Buffer.concat(chunks));
          });
          readStream.on('error', rejectPromise);
        });
      });
      zipFile.on('end', () => {
        rejectPromise(new Error(`Pack entry not found: ${entryName}`));
      });
      zipFile.on('error', rejectPromise);
    });
  });
}

async function extractZipEntry(
  packPath: string,
  entryName: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const buffer = await readZipEntryBuffer(packPath, entryName);
  await writeFile(destinationPath, buffer);
}

async function readPackCreatedAt(packPath: string): Promise<string | undefined> {
  try {
    const raw = await readZipEntryBuffer(packPath, SESSION_PACK_MANIFEST_ENTRY);
    const manifest = parseSessionPackManifest(raw.toString('utf8'));
    return manifest.createdAt;
  } catch {
    return undefined;
  }
}

function formatSidecar(sha256: string, fileName: string): string {
  return `${sha256}  ${fileName}\n`;
}

async function readSidecarSha256(sidecarPath: string, expectedFileName: string): Promise<string> {
  const raw = (await readFile(sidecarPath, 'utf8')).trim();
  const match = /^([a-f0-9]{64})(?:\s+\*?(.+))?$/i.exec(raw);
  if (!match) {
    throw new Error(`Invalid pack sidecar format: ${sidecarPath}`);
  }
  const digest = match[1]!.toLowerCase();
  const named = match[2];
  if (named && basename(named) !== expectedFileName) {
    throw new Error(
      `Pack sidecar filename mismatch: expected ${expectedFileName}, got ${named}`,
    );
  }
  return digest;
}

async function assertWritableDirectory(directory: string): Promise<void> {
  const probe = join(directory, `.piwin-pack-write-probe-${process.pid}`);
  try {
    await writeFile(probe, 'ok\n', 'utf8');
  } finally {
    await rm(probe, { force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
