import { rm } from 'node:fs/promises';
import type {
  SessionColdStorageReconcileReport,
  SessionColdStorageReconcileResult,
  SessionIndexRecord,
} from '@piwin/contracts';
import { getSessionRecord, listAllSessionRecords, upsertSessionRecord } from './session-index-store.js';
import {
  getColdStorageExtractDir,
  getColdStorageQuarantineDir,
  listColdStorageJournals,
  pathExists,
  removeColdStorageTransaction,
  updateColdStorageJournalPhase,
  type ColdStorageJournalV1,
} from './session-cold-storage-journal.js';
import { restorePayloadFromQuarantine } from './session-cold-storage-offload.js';
import { verifySessionPack } from './session-pack.js';

export type RecoverColdStorageInput = {
  rootDir: string;
  indexPath: string;
  resolvePaths: (sessionId: string) => { transcriptPath: string; mediaDir: string };
};

export async function recoverJournaledColdStorageTransactions(
  input: RecoverColdStorageInput,
): Promise<SessionColdStorageReconcileResult> {
  const recovered: SessionColdStorageReconcileResult['recovered'] = [];
  const reports: SessionColdStorageReconcileReport[] = [];
  const updatedSessionIds: string[] = [];

  for (const journal of await listColdStorageJournals(input.rootDir)) {
    const outcome = await recoverOneJournal(input, journal, reports);
    if (outcome) {
      recovered.push(outcome);
      if (outcome.updated) {
        updatedSessionIds.push(journal.sessionId);
      }
    }
  }

  return { recovered, updatedSessionIds, reports };
}

export async function reconcileSessionColdStorage(input: RecoverColdStorageInput): Promise<SessionColdStorageReconcileResult> {
  const recovered = await recoverJournaledColdStorageTransactions(input);
  const records = await listAllSessionRecords(input.indexPath);
  const reports = [...recovered.reports];
  const updatedSessionIds = [...recovered.updatedSessionIds];

  for (const record of records) {
    const state = record.storage?.state;
    if (state !== 'offloaded' && state !== 'missing-pack') {
      const paths = input.resolvePaths(record.id);
      if (record.storage?.state === 'local' && !(await pathExists(paths.transcriptPath))) {
        reports.push({
          kind: 'dirty-metadata',
          sessionId: record.id,
          detail: 'index says local but transcript.sqlite3 is missing',
        });
      }
      continue;
    }
    const packPath = record.storage?.packPath;
    if (!packPath) {
      if (state === 'offloaded') {
        await markMissingPack(input.indexPath, record, updatedSessionIds);
        reports.push({
          kind: 'missing-pack',
          sessionId: record.id,
          detail: 'offloaded stub has no packPath',
        });
      }
      continue;
    }
    try {
      await verifySessionPack({ packPath });
      if (state === 'missing-pack') {
        record.storage = { ...record.storage, state: 'offloaded' };
        await upsertSessionRecord(input.indexPath, record);
        updatedSessionIds.push(record.id);
        reports.push({
          kind: 'pack-readable',
          sessionId: record.id,
          detail: `pack is readable again at ${packPath}`,
        });
      }
    } catch (error) {
      if (state === 'offloaded') {
        await markMissingPack(input.indexPath, record, updatedSessionIds);
      }
      reports.push({
        kind: 'missing-pack',
        sessionId: record.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const paths = input.resolvePaths(record.id);
    if (await pathExists(paths.transcriptPath)) {
      reports.push({
        kind: 'split-brain',
        sessionId: record.id,
        detail: 'index is offloaded/missing-pack but a local transcript still exists',
      });
    }
  }

  return {
    recovered: recovered.recovered,
    updatedSessionIds: [...new Set(updatedSessionIds)],
    reports,
  };
}

async function recoverOneJournal(
  input: RecoverColdStorageInput,
  journal: ColdStorageJournalV1,
  reports: SessionColdStorageReconcileReport[],
): Promise<{ transactionId: string; sessionId: string; action: string; updated?: true } | undefined> {
  const paths = input.resolvePaths(journal.sessionId);
  const quarantineDir = getColdStorageQuarantineDir(input.rootDir, journal.transactionId);
  const extractDir = getColdStorageExtractDir(input.rootDir, journal.transactionId);

  if (journal.phase === 'committed' || journal.phase === 'aborted') {
    await removeColdStorageTransaction(input.rootDir, journal.transactionId);
    return {
      transactionId: journal.transactionId,
      sessionId: journal.sessionId,
      action: `cleaned-${journal.phase}`,
    };
  }

  if (journal.phase === 'started' || journal.phase === 'published') {
    await removeColdStorageTransaction(input.rootDir, journal.transactionId);
    reports.push({
      kind: 'residual-transaction',
      sessionId: journal.sessionId,
      transactionId: journal.transactionId,
      detail: `${journal.kind} stopped at ${journal.phase}; local remains authority`,
    });
    return {
      transactionId: journal.transactionId,
      sessionId: journal.sessionId,
      action: 'discard-incomplete-publish',
    };
  }

  if (journal.phase === 'payload-moved') {
    const record = await getSessionRecord(input.indexPath, journal.sessionId);
    const indexOffloaded = record?.storage?.state === 'offloaded';
    if (indexOffloaded) {
      await rm(quarantineDir, { recursive: true, force: true });
      await removeColdStorageTransaction(input.rootDir, journal.transactionId);
      return {
        transactionId: journal.transactionId,
        sessionId: journal.sessionId,
        action: 'drop-quarantine-pack-authority',
      };
    }
    if (await pathExists(paths.transcriptPath)) {
      reports.push({
        kind: 'split-brain',
        sessionId: journal.sessionId,
        transactionId: journal.transactionId,
        detail: 'payload moved but local transcript and local index both remain',
      });
      return undefined;
    }
    await restorePayloadFromQuarantine({
      transcriptPath: paths.transcriptPath,
      mediaDir: paths.mediaDir,
      quarantineDir,
    });
    await updateColdStorageJournalPhase(input.rootDir, journal, 'aborted');
    await removeColdStorageTransaction(input.rootDir, journal.transactionId);
    return {
      transactionId: journal.transactionId,
      sessionId: journal.sessionId,
      action: 'restore-quarantine-local-authority',
      updated: true,
    };
  }

  if (journal.phase === 'indexed') {
    await rm(quarantineDir, { recursive: true, force: true });
    await removeColdStorageTransaction(input.rootDir, journal.transactionId);
    return {
      transactionId: journal.transactionId,
      sessionId: journal.sessionId,
      action: 'drop-quarantine-after-index',
    };
  }

  if (journal.phase === 'extracted') {
    reports.push({
      kind: 'residual-transaction',
      sessionId: journal.sessionId,
      transactionId: journal.transactionId,
      detail: 'restore extracted but not committed; leaving extract for a later restore',
    });
    if (await pathExists(extractDir) && (await pathExists(paths.transcriptPath))) {
      reports.push({
        kind: 'split-brain',
        sessionId: journal.sessionId,
        transactionId: journal.transactionId,
        detail: 'restore extract and local transcript both exist',
      });
    }
    return undefined;
  }

  reports.push({
    kind: 'residual-transaction',
    sessionId: journal.sessionId,
    transactionId: journal.transactionId,
    detail: `unhandled journal phase ${journal.phase}`,
  });
  return undefined;
}

async function markMissingPack(
  indexPath: string,
  record: SessionIndexRecord,
  updatedSessionIds: string[],
): Promise<void> {
  if (!record.storage || record.storage.state === 'missing-pack') {
    return;
  }
  record.storage = { ...record.storage, state: 'missing-pack' };
  await upsertSessionRecord(indexPath, record);
  updatedSessionIds.push(record.id);
}
