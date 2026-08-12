import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionIndexRecord, SessionPackManifestV1 } from '@piwin/contracts';
import { SessionPackInvalidError, SessionStorageConflictError } from '@piwin/contracts';
import {
  createSessionRecord,
  getSessionRecord,
  upsertSessionRecord,
} from './session-index-store.js';
import {
  createColdStorageJournal,
  getColdStorageExtractDir,
  pathExists,
  removeColdStorageTransaction,
  updateColdStorageJournalPhase,
} from './session-cold-storage-journal.js';
import { extractVerifiedSessionPack } from './session-pack.js';

export type RestoreSessionInput = {
  rootDir: string;
  indexPath: string;
  sessionId: string;
  packPath: string;
  transcriptPath: string;
  mediaDir: string;
  now?: Date;
};

export type RestoreSessionResult = {
  sessionId: string;
  packId: string;
  packPath: string;
  createdIndexRecord: boolean;
};

export async function restoreSessionPayload(
  input: RestoreSessionInput,
): Promise<RestoreSessionResult> {
  const existing = await getSessionRecord(input.indexPath, input.sessionId);
  if (existing && (existing.storage === undefined || existing.storage.state === 'local')) {
    if (await pathExists(input.transcriptPath)) {
      throw new SessionStorageConflictError(
        input.sessionId,
        'already has a local body; force replace is out of R1',
      );
    }
  }

  let journal = await createColdStorageJournal({
    rootDir: input.rootDir,
    kind: 'restore',
    sessionId: input.sessionId,
    ...(input.now ? { now: input.now } : {}),
  });
  try {
    const extractDir = getColdStorageExtractDir(input.rootDir, journal.transactionId);
    const extracted = await extractVerifiedSessionPack({
      packPath: input.packPath,
      destinationDir: extractDir,
    });
    if (extracted.verified.sessionId !== input.sessionId) {
      throw new SessionPackInvalidError(
        `pack session ${extracted.verified.sessionId} does not match ${input.sessionId}`,
      );
    }
    if (existing?.storage?.packArchiveSha256) {
      if (existing.storage.packArchiveSha256 !== extracted.verified.archiveSha256) {
        throw new SessionPackInvalidError('pack archive hash does not match the session stub');
      }
    }
    journal = await updateColdStorageJournalPhase(input.rootDir, journal, 'extracted', {
      packId: extracted.verified.packId,
      packPath: extracted.verified.packPath,
      packArchiveSha256: extracted.verified.archiveSha256,
      transcriptSha256: extracted.verified.transcriptSha256,
      ...(extracted.verified.mediaTreeSha256
        ? { mediaTreeSha256: extracted.verified.mediaTreeSha256 }
        : {}),
      payloadBytes: extracted.verified.payloadBytes,
    });

    if (await pathExists(input.transcriptPath)) {
      throw new SessionStorageConflictError(
        input.sessionId,
        'already has a local body; force replace is out of R1',
      );
    }

    await mkdir(dirname(input.transcriptPath), { recursive: true });
    await rename(extracted.transcriptPath, input.transcriptPath);
    if (extracted.mediaDir) {
      if (await pathExists(input.mediaDir)) {
        await rm(input.mediaDir, { recursive: true, force: true });
      }
      await mkdir(dirname(input.mediaDir), { recursive: true });
      await rename(extracted.mediaDir, input.mediaDir);
    }

    const createdIndexRecord = existing === undefined;
    const record = existing ?? recordFromManifest(extracted.manifest);
    delete record.storage;
    await upsertSessionRecord(input.indexPath, record);
    journal = await updateColdStorageJournalPhase(input.rootDir, journal, 'committed');
    await removeColdStorageTransaction(input.rootDir, journal.transactionId);
    return {
      sessionId: input.sessionId,
      packId: extracted.verified.packId,
      packPath: extracted.verified.packPath,
      createdIndexRecord,
    };
  } catch (error) {
    if (journal.phase !== 'committed') {
      await updateColdStorageJournalPhase(input.rootDir, journal, 'aborted').catch(() => undefined);
    }
    throw error;
  }
}

function recordFromManifest(manifest: SessionPackManifestV1): SessionIndexRecord {
  const record = createSessionRecord({
    id: manifest.session.id,
    projectPath: manifest.session.projectPath,
    ...(manifest.session.scope ? { scope: manifest.session.scope } : {}),
    ...(manifest.session.workingDirectory
      ? { workingDirectory: manifest.session.workingDirectory }
      : {}),
    ...(manifest.session.name ? { name: manifest.session.name } : {}),
    ...(manifest.session.kind ? { kind: manifest.session.kind } : {}),
  });
  record.createdAt = manifest.session.createdAt;
  record.updatedAt = manifest.session.updatedAt;
  record.messageCount = manifest.session.messageCount;
  if (manifest.session.lastPreview) {
    record.lastPreview = manifest.session.lastPreview;
  }
  if (manifest.session.archivedAt) {
    record.isArchived = true;
    record.archivedAt = manifest.session.archivedAt;
  }
  if (manifest.session.isPinned === true) {
    record.isPinned = true;
  }
  return record;
}
