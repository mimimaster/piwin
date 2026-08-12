import { randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SessionColdStorageTransactionKind,
  SessionColdStorageTransactionPhase,
} from '@piwin/contracts';
import { writeTextFileAtomic } from './atomic-text-file.js';

export type ColdStorageJournalV1 = {
  version: 1;
  transactionId: string;
  kind: SessionColdStorageTransactionKind;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  phase: SessionColdStorageTransactionPhase;
  packId?: string;
  packPath?: string;
  packArchiveSha256?: string;
  transcriptSha256?: string;
  mediaTreeSha256?: string;
  payloadBytes?: number;
};

export function getColdStorageTransactionsDir(rootDir: string): string {
  return join(rootDir, 'cold-storage', 'transactions');
}

export function getColdStorageTransactionDir(rootDir: string, transactionId: string): string {
  return join(getColdStorageTransactionsDir(rootDir), transactionId);
}

export function getColdStorageJournalPath(rootDir: string, transactionId: string): string {
  return join(getColdStorageTransactionDir(rootDir, transactionId), 'journal.json');
}

export function getColdStorageQuarantineDir(rootDir: string, transactionId: string): string {
  return join(getColdStorageTransactionDir(rootDir, transactionId), 'payload');
}

export function getColdStorageExtractDir(rootDir: string, transactionId: string): string {
  return join(getColdStorageTransactionDir(rootDir, transactionId), 'extract');
}

export function createColdStorageTransactionId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `tx-${stamp}-${randomBytes(4).toString('hex')}`;
}

export async function createColdStorageJournal(input: {
  rootDir: string;
  kind: SessionColdStorageTransactionKind;
  sessionId: string;
  now?: Date;
}): Promise<ColdStorageJournalV1> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const journal: ColdStorageJournalV1 = {
    version: 1,
    transactionId: createColdStorageTransactionId(now),
    kind: input.kind,
    sessionId: input.sessionId,
    createdAt,
    updatedAt: createdAt,
    phase: 'started',
  };
  await writeColdStorageJournal(input.rootDir, journal);
  return journal;
}

export async function writeColdStorageJournal(
  rootDir: string,
  journal: ColdStorageJournalV1,
): Promise<void> {
  const filePath = getColdStorageJournalPath(rootDir, journal.transactionId);
  await mkdir(getColdStorageTransactionDir(rootDir, journal.transactionId), { recursive: true });
  await writeTextFileAtomic(filePath, `${JSON.stringify(journal, null, 2)}\n`);
}

export async function updateColdStorageJournalPhase(
  rootDir: string,
  journal: ColdStorageJournalV1,
  phase: SessionColdStorageTransactionPhase,
  patch?: Partial<ColdStorageJournalV1>,
): Promise<ColdStorageJournalV1> {
  const next: ColdStorageJournalV1 = {
    ...journal,
    ...patch,
    phase,
    updatedAt: new Date().toISOString(),
  };
  await writeColdStorageJournal(rootDir, next);
  return next;
}

export async function readColdStorageJournal(
  rootDir: string,
  transactionId: string,
): Promise<ColdStorageJournalV1 | undefined> {
  try {
    const raw = await readFile(getColdStorageJournalPath(rootDir, transactionId), 'utf8');
    const parsed = JSON.parse(raw) as ColdStorageJournalV1;
    if (parsed.version !== 1 || typeof parsed.transactionId !== 'string') {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function listColdStorageJournals(rootDir: string): Promise<ColdStorageJournalV1[]> {
  const directory = getColdStorageTransactionsDir(rootDir);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const journals: ColdStorageJournalV1[] = [];
  for (const name of names.sort()) {
    const journal = await readColdStorageJournal(rootDir, name);
    if (journal) {
      journals.push(journal);
    }
  }
  return journals;
}

export async function removeColdStorageTransaction(
  rootDir: string,
  transactionId: string,
): Promise<void> {
  await rm(getColdStorageTransactionDir(rootDir, transactionId), { recursive: true, force: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
