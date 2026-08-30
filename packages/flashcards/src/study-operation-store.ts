import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  StudyStorageError,
  type FlashcardStudyChangedReason,
  type FlashcardStudyOperationResult,
  type FlashcardStudyRound,
  type FlashcardStudyUndoImage,
  type ReviewState,
} from '@piwin/contracts';
import { isolateCorruptFile, writeJsonAtomic, type AtomicJsonWriteHooks } from './atomic-json-file.js';
import { assertInsideFlashcardsRoot, getStudyOperationsDir } from './paths.js';
import { digestIdempotencyKey } from './study-content-version.js';
import { removeTmpFiles } from './atomic-json-file.js';

export const DURABLE_STUDY_OPERATION_SCHEMA_VERSION = 1 as const;

export type DurableStudyCommandType = FlashcardStudyChangedReason;

export type DurableStudyOperation = {
  schemaVersion: typeof DURABLE_STUDY_OPERATION_SCHEMA_VERSION;
  sequence: number;
  idempotencyKey: string;
  keyHash: string;
  payloadDigest: string;
  commandType: DurableStudyCommandType;
  hostTimestamp: string;
  applied: boolean;
  beforeRevision: number;
  afterRevision: number;
  result: FlashcardStudyOperationResult;
  undoBefore?: FlashcardStudyUndoImage;
  undoAfter?: FlashcardStudyUndoImage;
  reviewStateRevisionBefore?: number;
  reviewStateRevisionAfter?: number;
  targetRound?: FlashcardStudyRound;
  targetReviewState?: ReviewState;
  /** Authenticated connection that submitted the mutation. Absent on pre-P3 logs. */
  principalId?: string;
};

export type StudyOperationStoreOptions = {
  flashcardsRoot: string;
  writeHooks?: () => AtomicJsonWriteHooks | undefined;
};

export type StudyOperationStore = {
  ensureDir: () => Promise<string>;
  nextSequence: () => Promise<number>;
  read: (sequence: number, keyHash: string) => Promise<DurableStudyOperation | null>;
  write: (record: DurableStudyOperation) => Promise<void>;
  markApplied: (record: DurableStudyOperation) => Promise<DurableStudyOperation>;
  findByIdempotencyKey: (idempotencyKey: string) => Promise<DurableStudyOperation | null>;
  listInOrder: () => Promise<DurableStudyOperation[]>;
  cleanupTemps: () => Promise<void>;
};

const FILE_PATTERN = /^(\d+)-([a-f0-9]+)\.json$/;

export function operationFileName(sequence: number, keyHash: string): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new StudyStorageError(`invalid operation sequence ${sequence}`);
  }
  if (!/^[a-f0-9]+$/.test(keyHash)) {
    throw new StudyStorageError('invalid operation key hash');
  }
  return `${sequence}-${keyHash}.json`;
}

export function createStudyOperationStore(options: StudyOperationStoreOptions): StudyOperationStore {
  const operationsDir = getStudyOperationsDir(options.flashcardsRoot);

  function filePath(sequence: number, keyHash: string): string {
    return assertInsideFlashcardsRoot(
      options.flashcardsRoot,
      join(operationsDir, operationFileName(sequence, keyHash)),
    );
  }

  async function ensureDir(): Promise<string> {
    await mkdir(operationsDir, { recursive: true });
    return operationsDir;
  }

  async function listEntries(): Promise<string[]> {
    await ensureDir();
    try {
      return await readdir(operationsDir);
    } catch (error) {
      throw new StudyStorageError(
        `failed to list study operations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function parseOperationFile(path: string, label: string): Promise<DurableStudyOperation> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      throw new StudyStorageError(
        `failed to read operation ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const parsed = JSON.parse(raw) as DurableStudyOperation;
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      if (parsed.schemaVersion !== DURABLE_STUDY_OPERATION_SCHEMA_VERSION) {
        throw new Error(`unsupported schemaVersion ${String(parsed.schemaVersion)}`);
      }
      if (!Number.isSafeInteger(parsed.sequence) || parsed.sequence < 1) {
        throw new Error('invalid sequence');
      }
      if (typeof parsed.idempotencyKey !== 'string' || typeof parsed.keyHash !== 'string') {
        throw new Error('missing idempotency identity');
      }
      if (typeof parsed.payloadDigest !== 'string' || typeof parsed.hostTimestamp !== 'string') {
        throw new Error('missing payload or timestamp');
      }
      if (typeof parsed.applied !== 'boolean' || typeof parsed.commandType !== 'string') {
        throw new Error('missing applied/commandType');
      }
      if (!parsed.result || typeof parsed.result !== 'object') {
        throw new Error('missing result');
      }
      return parsed;
    } catch (error) {
      const backup = await isolateCorruptFile(path);
      throw new StudyStorageError(
        `corrupt study operation ${label} preserved at ${backup}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async function nextSequence(): Promise<number> {
    const entries = await listEntries();
    let max = 0;
    for (const entry of entries) {
      const match = /^(\d+)-/.exec(entry);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value > max) max = value;
    }
    return max + 1;
  }

  async function read(sequence: number, keyHash: string): Promise<DurableStudyOperation | null> {
    const path = filePath(sequence, keyHash);
    try {
      await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StudyStorageError(
        `failed to read operation ${sequence}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parseOperationFile(path, `${sequence}-${keyHash}`);
  }

  async function write(record: DurableStudyOperation): Promise<void> {
    await ensureDir();
    await writeJsonAtomic(filePath(record.sequence, record.keyHash), record, options.writeHooks?.());
  }

  async function markApplied(record: DurableStudyOperation): Promise<DurableStudyOperation> {
    const next: DurableStudyOperation = { ...record, applied: true };
    await write(next);
    return next;
  }

  async function findByIdempotencyKey(idempotencyKey: string): Promise<DurableStudyOperation | null> {
    const keyHash = digestIdempotencyKey(idempotencyKey);
    const entries = await listEntries();
    const matches = entries.filter((entry) => entry.endsWith(`-${keyHash}.json`));
    if (matches.length === 0) return null;
    matches.sort();
    const latest = matches[matches.length - 1];
    if (!latest) return null;
    const parsedName = FILE_PATTERN.exec(latest);
    if (!parsedName) {
      throw new StudyStorageError(`invalid operation filename ${latest}`);
    }
    return parseOperationFile(
      assertInsideFlashcardsRoot(options.flashcardsRoot, join(operationsDir, latest)),
      latest,
    );
  }

  async function listInOrder(): Promise<DurableStudyOperation[]> {
    const entries = await listEntries();
    const files: Array<{ sequence: number; name: string }> = [];
    for (const entry of entries) {
      if (entry.endsWith('.tmp') || entry.endsWith('.corrupt')) continue;
      const match = FILE_PATTERN.exec(entry);
      if (!match) continue;
      files.push({ sequence: Number(match[1]), name: entry });
    }
    files.sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));
    const records: DurableStudyOperation[] = [];
    for (const file of files) {
      records.push(
        await parseOperationFile(
          assertInsideFlashcardsRoot(options.flashcardsRoot, join(operationsDir, file.name)),
          file.name,
        ),
      );
    }
    return records;
  }

  async function cleanupTemps(): Promise<void> {
    await ensureDir();
    await removeTmpFiles(operationsDir);
  }

  return {
    ensureDir,
    nextSequence,
    read,
    write,
    markApplied,
    findByIdempotencyKey,
    listInOrder,
    cleanupTemps,
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

export async function countOperationFiles(flashcardsRoot: string): Promise<number> {
  const dir = getStudyOperationsDir(flashcardsRoot);
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => FILE_PATTERN.test(entry)).length;
  } catch {
    return 0;
  }
}
