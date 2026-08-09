/**
 * Persisted Walkthrough Artifact store (spec §7.2).
 *
 * Each final Assistant message may have at most one Walkthrough artifact,
 * persisted as JSON at `~/.piwin/sessions/<sessionId>/walkthroughs/<encoded-message-id>.json`.
 * The store only reads/writes artifact metadata and generated Markdown; it
 * never persists raw, un-redacted evidence (spec §7.2, §1.2).
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionTranscriptDocument, WalkthroughArtifact } from '@piwin/contracts';
import {
  getPiwinSessionTranscriptPath,
  getPiwinSessionWalkthroughDir,
  getPiwinSessionWalkthroughMdPath,
  getPiwinSessionWalkthroughPath,
} from './paths.js';

/** Current persisted artifact schema version; older versions are ignored by `listWalkthroughs`. */
const WALKTHROUGH_ARTIFACT_VERSION = 1;

function isModelRef(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const model = value as Record<string, unknown>;
  return (
    typeof model.protocol === 'string' &&
    model.protocol.length > 0 &&
    typeof model.providerId === 'string' &&
    model.providerId.length > 0 &&
    typeof model.modelId === 'string' &&
    model.modelId.length > 0
  );
}

function isWalkthroughError(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const error = value as Record<string, unknown>;
  return typeof error.code === 'string' && typeof error.message === 'string';
}

/**
 * Sound type guard for persisted Walkthrough artifacts.
 *
 * The base fields are validated once, then the guard branches on `status` and
 * validates the variant-specific required fields. This prevents a corrupted
 * disk file (e.g. `status: 'ready'` with no `markdown`/`model`) from passing the
 * guard and causing runtime undefined access downstream (spec §7.2).
 */
function isWalkthroughArtifact(value: unknown): value is WalkthroughArtifact {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== WALKTHROUGH_ARTIFACT_VERSION ||
    typeof record.id !== 'string' ||
    typeof record.sessionId !== 'string' ||
    typeof record.messageId !== 'string' ||
    typeof record.mode !== 'string' ||
    typeof record.sourceHash !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return false;
  }
  switch (record.status) {
    case 'generating':
      return typeof record.generationId === 'string';
    case 'ready':
      return (
        typeof record.markdown === 'string' &&
        typeof record.generatedAt === 'string' &&
        isModelRef(record.model)
      );
    case 'error':
      return isWalkthroughError(record.error) && typeof record.generatedAt === 'string';
    default:
      return false;
  }
}

/**
 * Loads the transcript for a session and returns the set of message IDs it
 * still contains. Used to filter orphan walkthrough artifacts whose bound
 * message was truncated from the transcript (spec §7.2). Returns an empty
 * set when the transcript does not exist.
 */
async function loadTranscriptMessageIds(rootDir: string, sessionId: string): Promise<Set<string>> {
  const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
  let raw: string;
  try {
    raw = await readFile(transcriptPath, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return new Set();
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!isSessionTranscriptDocument(parsed)) {
    return new Set();
  }
  return new Set(parsed.messages.map((message) => message.id));
}

function isSessionTranscriptDocument(value: unknown): value is SessionTranscriptDocument {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === 1 && Array.isArray(record.messages);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * Atomically writes JSON to `targetPath`. Writes to a sibling temp file then
 * renames, so a crash mid-write never leaves a partially-written artifact
 * (spec §7.2 "JSON 采用原子写入").
 */
async function writeJsonAtomic(targetPath: string, data: WalkthroughArtifact): Promise<void> {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, json, 'utf8');
  await rename(tmpPath, targetPath);
}

/**
 * Lists persisted Walkthrough artifacts for a session. Only artifacts with the
 * current schema `version` are returned; orphans (whose `messageId` no longer
 * exists in the transcript) are skipped (spec §7.2). When the transcript is
 * missing, returns an empty array.
 */
export type ListWalkthroughsOptions = {
  /**
   * When provided (e.g. from a just-loaded transcript), skip re-reading
   * transcript.json solely to filter orphan walkthrough files.
   */
  validMessageIds?: ReadonlySet<string> | readonly string[];
  /** Store-backed orphan check used after transcript.json migration. */
  messageExists?: (messageId: string) => Promise<boolean>;
};

export async function listWalkthroughs(
  rootDir: string,
  sessionId: string,
  options?: ListWalkthroughsOptions,
): Promise<WalkthroughArtifact[]> {
  const validMessageIds = options?.validMessageIds
    ? options.validMessageIds instanceof Set
      ? options.validMessageIds
      : new Set(options.validMessageIds)
    : options?.messageExists
      ? null
      : await loadTranscriptMessageIds(rootDir, sessionId);
  if (validMessageIds !== null && validMessageIds.size === 0) {
    return [];
  }
  const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const artifacts: WalkthroughArtifact[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const filePath = join(dir, entry);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isWalkthroughArtifact(parsed)) {
      continue;
    }
    // Skip orphans: the bound message was truncated from the transcript.
    const messageExists = validMessageIds !== null
      ? validMessageIds.has(parsed.messageId)
      : await options?.messageExists?.(parsed.messageId);
    if (messageExists !== true) {
      continue;
    }
    artifacts.push(parsed);
  }
  return artifacts;
}

/**
 * Loads a single Walkthrough artifact by `messageId`, or `null` if no
 * persisted file exists for that message.
 */
export async function loadWalkthrough(
  rootDir: string,
  sessionId: string,
  messageId: string,
): Promise<WalkthroughArtifact | null> {
  const filePath = getPiwinSessionWalkthroughPath(rootDir, sessionId, messageId);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isWalkthroughArtifact(parsed) ? parsed : null;
}

/**
 * Persists a Walkthrough artifact atomically, creating the walkthroughs
 * directory recursively if needed (spec §7.2). Only artifact metadata and
 * generated Markdown are written; callers must ensure no raw evidence is
 * attached to the artifact before saving.
 */
export async function saveWalkthrough(
  rootDir: string,
  sessionId: string,
  artifact: WalkthroughArtifact,
): Promise<void> {
  const filePath = getPiwinSessionWalkthroughPath(rootDir, sessionId, artifact.messageId);
  const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(filePath, artifact);

  // Write a companion `.md` file for ready artifacts so users and external
  // tools can read the walkthrough as plain Markdown (aligning with Google
  // Antigravity's walkthrough.md Artifact pattern). Non-ready artifacts
  // (generating/error) have no markdown content to write.
  if (artifact.status === 'ready') {
    const mdPath = getPiwinSessionWalkthroughMdPath(rootDir, sessionId, artifact.messageId);
    await writeFile(mdPath, artifact.markdown, 'utf8');
  }
}

/**
 * Deletes a single Walkthrough artifact for `messageId`. No-op if the file
 * does not exist.
 */
export async function deleteWalkthrough(
  rootDir: string,
  sessionId: string,
  messageId: string,
): Promise<void> {
  const filePath = getPiwinSessionWalkthroughPath(rootDir, sessionId, messageId);
  const mdPath = getPiwinSessionWalkthroughMdPath(rootDir, sessionId, messageId);
  await Promise.all([
    rm(filePath, { force: true }).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    }),
    rm(mdPath, { force: true }).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    }),
  ]);
}

/**
 * Removes the entire walkthroughs directory for a session. Called on session
 * permanent deletion so artifacts do not outlive their session (spec §7.2).
 */
export async function deleteSessionWalkthroughs(rootDir: string, sessionId: string): Promise<void> {
  const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}
