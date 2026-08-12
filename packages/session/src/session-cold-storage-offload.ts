import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionIndexRecord } from '@piwin/contracts';
import { SessionPackStaleError } from '@piwin/contracts';
import { getSessionRecord, upsertSessionRecord } from './session-index-store.js';
import {
  createColdStorageJournal,
  getColdStorageQuarantineDir,
  pathExists,
  removeColdStorageTransaction,
  updateColdStorageJournalPhase,
  type ColdStorageJournalV1,
} from './session-cold-storage-journal.js';
import { checkpointTranscriptWal, createSessionPack, hashSessionPayload } from './session-pack.js';

export type OffloadSessionHooks = {
  beforePublish?: () => Promise<void>;
  afterPublish?: () => Promise<void>;
  mutateLocalAfterPublish?: () => Promise<void>;
  afterPayloadMoved?: () => Promise<void>;
  afterIndexed?: () => Promise<void>;
};

export type OffloadSessionInput = {
  rootDir: string;
  indexPath: string;
  record: SessionIndexRecord;
  transcriptPath: string;
  mediaDir: string;
  stagingDir: string;
  outputDir: string;
  expectedTranscriptSha256: string;
  expectedMediaTreeSha256?: string;
  now?: Date;
  hooks?: OffloadSessionHooks;
};

export type OffloadSessionResult = {
  sessionId: string;
  packId: string;
  packPath: string;
  payloadBytes: number;
  journal: ColdStorageJournalV1;
};

export async function offloadSessionPayload(
  input: OffloadSessionInput,
): Promise<OffloadSessionResult> {
  let journal = await createColdStorageJournal({
    rootDir: input.rootDir,
    kind: 'offload',
    sessionId: input.record.id,
    ...(input.now ? { now: input.now } : {}),
  });
  try {
    await checkpointTranscriptWal(input.transcriptPath);
    const prePublish = await hashSessionPayload({
      transcriptPath: input.transcriptPath,
      mediaDir: input.mediaDir,
    });
    if (
      prePublish.transcriptSha256 !== input.expectedTranscriptSha256 ||
      (prePublish.mediaTreeSha256 ?? '') !== (input.expectedMediaTreeSha256 ?? '')
    ) {
      throw new SessionPackStaleError(input.record.id);
    }
    await input.hooks?.beforePublish?.();
    const packed = await createSessionPack({
      record: input.record,
      outputDir: input.outputDir,
      paths: {
        transcriptPath: input.transcriptPath,
        mediaDir: input.mediaDir,
        stagingDir: input.stagingDir,
      },
      ...(input.now ? { now: input.now } : {}),
    });
    journal = await updateColdStorageJournalPhase(input.rootDir, journal, 'published', {
      packId: packed.packId,
      packPath: packed.packPath,
      packArchiveSha256: packed.archiveSha256,
      transcriptSha256: packed.transcriptSha256,
      ...(packed.mediaTreeSha256 ? { mediaTreeSha256: packed.mediaTreeSha256 } : {}),
      payloadBytes: packed.payloadBytes,
    });
    await input.hooks?.afterPublish?.();
    await input.hooks?.mutateLocalAfterPublish?.();

    const current = await hashSessionPayload({
      transcriptPath: input.transcriptPath,
      mediaDir: input.mediaDir,
    });
    if (
      current.transcriptSha256 !== input.expectedTranscriptSha256 ||
      current.transcriptSha256 !== packed.transcriptSha256 ||
      (input.expectedMediaTreeSha256 ?? '') !== (current.mediaTreeSha256 ?? '') ||
      (packed.mediaTreeSha256 ?? '') !== (current.mediaTreeSha256 ?? '')
    ) {
      throw new SessionPackStaleError(input.record.id);
    }

    const quarantineDir = getColdStorageQuarantineDir(input.rootDir, journal.transactionId);
    await mkdir(quarantineDir, { recursive: true });
    await movePayloadToQuarantine({
      transcriptPath: input.transcriptPath,
      mediaDir: input.mediaDir,
      quarantineDir,
    });
    journal = await updateColdStorageJournalPhase(input.rootDir, journal, 'payload-moved');
    await input.hooks?.afterPayloadMoved?.();

    const latest = (await getSessionRecord(input.indexPath, input.record.id)) ?? input.record;
    latest.storage = {
      state: 'offloaded',
      packId: packed.packId,
      packPath: packed.packPath,
      packArchiveSha256: packed.archiveSha256,
      transcriptSha256: packed.transcriptSha256,
      offloadedAt: (input.now ?? new Date()).toISOString(),
      offloadedBytes: packed.payloadBytes,
      ...(packed.mediaTreeSha256 ? { mediaTreeSha256: packed.mediaTreeSha256 } : {}),
      ...(latest.lastPreview || latest.name
        ? { coldPreview: latest.lastPreview ?? latest.name }
        : {}),
    };
    await upsertSessionRecord(input.indexPath, latest);
    journal = await updateColdStorageJournalPhase(input.rootDir, journal, 'indexed');
    await input.hooks?.afterIndexed?.();

    await rm(quarantineDir, { recursive: true, force: true });
    journal = await updateColdStorageJournalPhase(input.rootDir, journal, 'committed');
    await removeColdStorageTransaction(input.rootDir, journal.transactionId);
    return {
      sessionId: input.record.id,
      packId: packed.packId,
      packPath: packed.packPath,
      payloadBytes: packed.payloadBytes,
      journal,
    };
  } catch (error) {
    // Only mark aborted while local is still the authority. Later phases
    // must remain journaled so startup recovery can finish deterministically.
    if (journal.phase === 'started' || journal.phase === 'published') {
      await updateColdStorageJournalPhase(input.rootDir, journal, 'aborted').catch(() => undefined);
    }
    throw error;
  }
}

export async function movePayloadToQuarantine(input: {
  transcriptPath: string;
  mediaDir: string;
  quarantineDir: string;
}): Promise<void> {
  await mkdir(input.quarantineDir, { recursive: true });
  await rename(input.transcriptPath, join(input.quarantineDir, 'transcript.sqlite3'));
  await moveIfPresent(`${input.transcriptPath}-wal`, join(input.quarantineDir, 'transcript.sqlite3-wal'));
  await moveIfPresent(`${input.transcriptPath}-shm`, join(input.quarantineDir, 'transcript.sqlite3-shm'));
  if (await pathExists(input.mediaDir)) {
    await rename(input.mediaDir, join(input.quarantineDir, 'media'));
  }
}

export async function restorePayloadFromQuarantine(input: {
  transcriptPath: string;
  mediaDir: string;
  quarantineDir: string;
}): Promise<void> {
  await mkdir(dirname(input.transcriptPath), { recursive: true });
  await rename(join(input.quarantineDir, 'transcript.sqlite3'), input.transcriptPath);
  await moveIfPresent(join(input.quarantineDir, 'transcript.sqlite3-wal'), `${input.transcriptPath}-wal`);
  await moveIfPresent(join(input.quarantineDir, 'transcript.sqlite3-shm'), `${input.transcriptPath}-shm`);
  const quarantinedMedia = join(input.quarantineDir, 'media');
  if (await pathExists(quarantinedMedia)) {
    await mkdir(dirname(input.mediaDir), { recursive: true });
    await rename(quarantinedMedia, input.mediaDir);
  }
}

async function moveIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await stat(sourcePath);
  } catch {
    return;
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
}
