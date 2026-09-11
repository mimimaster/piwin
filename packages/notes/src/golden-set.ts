/**
 * User-owned golden query set at `notes/.eval/golden.jsonl`.
 * Pin/load helpers for retrieval eval; the runner itself lives with the
 * knowledge retriever, not this package.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RecallEvalCase } from '@piwin/contracts';

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
