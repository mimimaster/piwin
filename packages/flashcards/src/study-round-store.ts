import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  StudyStorageError,
  validateFlashcardStudyRound,
  type FlashcardStudyMode,
  type FlashcardStudyRound,
  type FlashcardStudyRoundStatus,
  type FlashcardStudyScope,
} from '@piwin/contracts';
import {
  isolateCorruptFile,
  removeTmpFiles,
  writeJsonAtomic,
  type AtomicJsonWriteHooks,
} from './atomic-json-file.js';
import {
  assertInsideFlashcardsRoot,
  getStudyRoundsDir,
  sanitizeCardId,
} from './paths.js';
import { scopesEqual } from './study-content-version.js';

export type StudyRoundStoreOptions = {
  flashcardsRoot: string;
  writeHooks?: () => AtomicJsonWriteHooks | undefined;
};

export type StudyRoundStore = {
  ensureDir: () => Promise<string>;
  read: (roundId: string) => Promise<FlashcardStudyRound | null>;
  write: (round: FlashcardStudyRound) => Promise<void>;
  list: () => Promise<FlashcardStudyRound[]>;
  listUnfinished: () => Promise<FlashcardStudyRound[]>;
  findLatestUnfinished: (
    mode: FlashcardStudyMode,
    scope: FlashcardStudyScope,
  ) => Promise<FlashcardStudyRound | null>;
  cleanupTemps: () => Promise<void>;
};

const UNFINISHED: ReadonlySet<FlashcardStudyRoundStatus> = new Set(['active', 'paused']);

export function createStudyRoundStore(options: StudyRoundStoreOptions): StudyRoundStore {
  const roundsDir = getStudyRoundsDir(options.flashcardsRoot);

  function roundPath(roundId: string): string {
    const safe = sanitizeCardId(roundId);
    return assertInsideFlashcardsRoot(options.flashcardsRoot, join(roundsDir, `${safe}.json`));
  }

  async function ensureDir(): Promise<string> {
    await mkdir(roundsDir, { recursive: true });
    return roundsDir;
  }

  async function parseRoundFile(path: string, roundId: string): Promise<FlashcardStudyRound> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      throw new StudyStorageError(
        `failed to read round ${roundId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const parsed = JSON.parse(raw) as FlashcardStudyRound;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.roundId !== 'string') {
        throw new Error('missing roundId');
      }
      if (!Array.isArray(parsed.entries)) {
        throw new Error('missing entries');
      }
      const issues = validateFlashcardStudyRound(parsed);
      if (issues.length > 0) {
        throw new Error(issues.join('; '));
      }
      return parsed;
    } catch (error) {
      const backup = await isolateCorruptFile(path);
      throw new StudyStorageError(
        `corrupt study round ${roundId} preserved at ${backup}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async function read(roundId: string): Promise<FlashcardStudyRound | null> {
    const path = roundPath(roundId);
    try {
      await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StudyStorageError(
        `failed to read round ${roundId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parseRoundFile(path, roundId);
  }

  async function write(round: FlashcardStudyRound): Promise<void> {
    const issues = validateFlashcardStudyRound(round);
    if (issues.length > 0) {
      throw new StudyStorageError(`refusing to write invalid round: ${issues.join('; ')}`);
    }
    await ensureDir();
    await writeJsonAtomic(roundPath(round.roundId), round, options.writeHooks?.());
  }

  async function cleanupTemps(): Promise<void> {
    await ensureDir();
    await removeTmpFiles(roundsDir);
  }

  async function list(): Promise<FlashcardStudyRound[]> {
    await ensureDir();
    let entries: string[];
    try {
      entries = await readdir(roundsDir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new StudyStorageError(
        `failed to list study rounds: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const rounds: FlashcardStudyRound[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json')) continue;
      const roundId = entry.slice(0, -'.json'.length);
      rounds.push(await parseRoundFile(roundPath(roundId), roundId));
    }
    return rounds;
  }

  async function listUnfinished(): Promise<FlashcardStudyRound[]> {
    const rounds = await list();
    return rounds
      .filter((round) => UNFINISHED.has(round.status))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function findLatestUnfinished(
    mode: FlashcardStudyMode,
    scope: FlashcardStudyScope,
  ): Promise<FlashcardStudyRound | null> {
    const unfinished = await listUnfinished();
    return (
      unfinished.find((round) => round.mode === mode && scopesEqual(round.scope, scope)) ?? null
    );
  }

  return { ensureDir, read, write, list, listUnfinished, findLatestUnfinished, cleanupTemps };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}
