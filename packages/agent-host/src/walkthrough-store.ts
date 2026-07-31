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
  getPiwinSessionWalkthroughPath,
} from './paths.js';

/** Current persisted artifact schema version; older versions are ignored by `listWalkthroughs`. */
const WALKTHROUGH_ARTIFACT_VERSION = 1;

function isWalkthroughArtifact(value: unknown): value is WalkthroughArtifact {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === WALKTHROUGH_ARTIFACT_VERSION &&
    typeof record.id === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.messageId === 'string' &&
    typeof record.mode === 'string' &&
    typeof record.sourceHash === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    (record.status === 'generating' ||
      record.status === 'ready' ||
      record.status === 'error')
  );
}

/**
 * Loads the transcript for a session and returns the set of message IDs it
 * still contains. Used to filter orphan walkthrough artifacts whose bound
 * message was truncated from the transcript (spec §7.2). Returns an empty
 * set when the transcript does not exist.
 */
async function loadTranscriptMessageIds(
  rootDir: string,
  sessionId: string,
): Promise<Set<string>> {
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
export async function listWalkthroughs(
  rootDir: string,
  sessionId: string,
): Promise<WalkthroughArtifact[]> {
  const validMessageIds = await loadTranscriptMessageIds(rootDir, sessionId);
  if (validMessageIds.size === 0) {
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
    if (!validMessageIds.has(parsed.messageId)) {
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
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

/**
 * Removes the entire walkthroughs directory for a session. Called on session
 * permanent deletion so artifacts do not outlive their session (spec §7.2).
 */
export async function deleteSessionWalkthroughs(
  rootDir: string,
  sessionId: string,
): Promise<void> {
  const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}
