/**
 * Retrieval quality evaluation against a user-owned golden query set
 * (ADR 0018 §5: retrieval quality is measurable, not assumed).
 *
 * Golden set lives at `~/.piwin/notes/.eval/golden.jsonl` — one JSON object
 * per line: { "query": "...", "expectedNoteIds": ["..."], "note": "optional" }.
 * User data, never sqlite-only.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  NoteSearchHit,
  NoteSearchMode,
  RecallEvalCase,
  RecallEvalReport,
} from '@piwin/contracts';

export function getGoldenSetPath(notesRoot: string): string {
  return join(notesRoot, '.eval', 'golden.jsonl');
}

/** Parse golden.jsonl content; skips blank/comment/malformed lines (collected as warnings). */
export function parseGoldenSet(raw: string): {
  cases: RecallEvalCase[];
  warnings: string[];
} {
  const cases: RecallEvalCase[] = [];
  const warnings: string[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
      const expectedNoteIds = Array.isArray(parsed.expectedNoteIds)
        ? parsed.expectedNoteIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (!query || expectedNoteIds.length === 0) {
        warnings.push(`line ${index + 1}: missing query or expectedNoteIds`);
        continue;
      }
      const evalCase: RecallEvalCase = { query, expectedNoteIds };
      if (typeof parsed.note === 'string' && parsed.note) {
        evalCase.note = parsed.note;
      }
      cases.push(evalCase);
    } catch {
      warnings.push(`line ${index + 1}: invalid JSON`);
    }
  }
  return { cases, warnings };
}

export async function loadGoldenSet(notesRoot: string): Promise<{
  cases: RecallEvalCase[];
  warnings: string[];
}> {
  try {
    const raw = await readFile(getGoldenSetPath(notesRoot), 'utf8');
    return parseGoldenSet(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { cases: [], warnings: [] };
    }
    throw error;
  }
}

/** Append a case ("pin this result as expected answer" affordance). */
export async function appendGoldenCase(
  notesRoot: string,
  evalCase: RecallEvalCase,
): Promise<string> {
  const path = getGoldenSetPath(notesRoot);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(evalCase)}\n`, 'utf8');
  return path;
}

/**
 * Score one mode's retrieval against the golden set.
 * Pure given a search function — callers inject `searchNotes` bound to
 * index/provider so this module stays IO-free for ranking math.
 */
export async function runRecallEval(input: {
  cases: RecallEvalCase[];
  mode: NoteSearchMode;
  k?: number;
  search: (query: string, limit: number, mode: NoteSearchMode) => Promise<NoteSearchHit[]>;
  /**
   * Set by the caller's onWarning hook when vector/hybrid degraded to FTS
   * mid-run — the report is then marked so its numbers are not trusted as
   * measuring the labeled mode.
   */
  wasDegraded?: () => boolean;
}): Promise<RecallEvalReport> {
  const k = input.k && input.k > 0 ? Math.floor(input.k) : 5;
  const perCase: RecallEvalReport['perCase'] = [];
  let hitsAtK = 0;
  let reciprocalSum = 0;

  for (const evalCase of input.cases) {
    const hits = await input.search(evalCase.query, k, input.mode);
    const topIds = hits.map((hit) => hit.note.id);
    const expected = new Set(evalCase.expectedNoteIds);
    const rankIndex = topIds.findIndex((id) => expected.has(id));
    const hitRank = rankIndex === -1 ? null : rankIndex + 1;
    if (hitRank !== null) {
      hitsAtK += 1;
      reciprocalSum += 1 / hitRank;
    }
    perCase.push({ query: evalCase.query, hitRank, topIds });
  }

  const cases = input.cases.length;
  const degraded = input.wasDegraded?.() === true;
  return {
    runAt: new Date().toISOString(),
    mode: input.mode,
    ...(degraded ? { degraded: true } : {}),
    k,
    cases,
    recallAtK: cases > 0 ? hitsAtK / cases : 0,
    mrr: cases > 0 ? reciprocalSum / cases : 0,
    perCase,
  };
}
