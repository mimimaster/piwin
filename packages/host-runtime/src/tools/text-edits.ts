/**
 * Exact-text replacement for the Host `edit` tool.
 *
 * Same contract as Pi's native `edit` (the one models are prompted with):
 * `edits: [{ oldText, newText }]`, each matched against the *original* file,
 * unique, non-overlapping; BOM stripped and line endings normalized to LF
 * for matching, then restored. The messages mirror Pi's so model recovery
 * behaves the same.
 *
 * Deliberately no fuzzy fallback (Pi normalizes quotes, dashes and trailing
 * space when an exact match fails). Matching happens against the bytes on disk
 * at write time, under the file lock — that is what makes concurrent sessions
 * safe: a change elsewhere in the file survives, a change to the same region
 * fails the match. A fuzzy match could land an edit on text another session
 * just rewrote.
 */

export type TextEdit = { oldText: string; newText: string };

export class TextEditError extends Error {
  override readonly name = 'TextEditError';
}

export type NormalizedEditArguments =
  | { ok: true; path: string; edits: TextEdit[] }
  | { ok: false; message: string };

/**
 * Accept the shapes models actually send: `edits` as a JSON string, and the
 * legacy single `oldText` / `newText` pair (folded into `edits`).
 */
export function normalizeEditArguments(raw: Record<string, unknown>): NormalizedEditArguments {
  const path = raw.path ?? raw.file_path;
  if (typeof path !== 'string' || path.trim().length === 0) {
    return { ok: false, message: 'path is required' };
  }
  let editsValue: unknown = raw.edits;
  if (typeof editsValue === 'string') {
    try {
      editsValue = JSON.parse(editsValue);
    } catch {
      return { ok: false, message: 'edits must be an array of { oldText, newText }' };
    }
  }
  const edits: TextEdit[] = [];
  if (Array.isArray(editsValue)) {
    for (const entry of editsValue) {
      const record = entry as Record<string, unknown> | null;
      if (
        !record ||
        typeof record !== 'object' ||
        typeof record.oldText !== 'string' ||
        typeof record.newText !== 'string'
      ) {
        return { ok: false, message: 'every edits[] entry needs string oldText and newText' };
      }
      edits.push({ oldText: record.oldText, newText: record.newText });
    }
  } else if (editsValue !== undefined) {
    return { ok: false, message: 'edits must be an array of { oldText, newText }' };
  }
  if (typeof raw.oldText === 'string' && typeof raw.newText === 'string') {
    edits.push({ oldText: raw.oldText, newText: raw.newText });
  }
  if (edits.length === 0) {
    return { ok: false, message: 'edits must contain at least one replacement' };
  }
  return { ok: true, path: path.trim(), edits };
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlf = content.indexOf('\r\n');
  const lf = content.indexOf('\n');
  return crlf !== -1 && lf !== -1 && crlf < lf ? '\r\n' : '\n';
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const index = content.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + 1;
  }
}

function label(index: number, total: number): string {
  return total === 1 ? 'the text' : `edits[${index}]`;
}

/** Apply edits to LF-normalized content; throws TextEditError with a model-facing message. */
export function applyTextEditsToNormalized(
  content: string,
  edits: readonly TextEdit[],
  displayPath: string,
): string {
  const normalized = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));
  const matches: Array<{ index: number; start: number; end: number; newText: string }> = [];
  for (const [index, edit] of normalized.entries()) {
    if (edit.oldText.length === 0) {
      throw new TextEditError(
        normalized.length === 1
          ? `oldText must not be empty in ${displayPath}.`
          : `edits[${index}].oldText must not be empty in ${displayPath}.`,
      );
    }
    const start = content.indexOf(edit.oldText);
    if (start < 0) {
      throw new TextEditError(
        normalized.length === 1
          ? `Could not find the exact text in ${displayPath}. The old text must match exactly including all whitespace and newlines. If another session may have changed the file, read it again.`
          : `Could not find edits[${index}] in ${displayPath}. The oldText must match exactly including all whitespace and newlines. If another session may have changed the file, read it again.`,
      );
    }
    const occurrences = countOccurrences(content, edit.oldText);
    if (occurrences > 1) {
      throw new TextEditError(
        `Found ${occurrences} occurrences of ${label(index, normalized.length)} in ${displayPath}. ${
          normalized.length === 1 ? 'The text' : 'Each oldText'
        } must be unique. Please provide more context to make it unique.`,
      );
    }
    matches.push({ index, start, end: start + edit.oldText.length, newText: edit.newText });
  }
  matches.sort((left, right) => left.start - right.start);
  for (let position = 1; position < matches.length; position += 1) {
    const previous = matches[position - 1];
    const current = matches[position];
    if (previous && current && previous.end > current.start) {
      throw new TextEditError(
        `edits[${previous.index}] and edits[${current.index}] overlap in ${displayPath}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }
  let result = content;
  for (const match of [...matches].reverse()) {
    result = result.slice(0, match.start) + match.newText + result.slice(match.end);
  }
  if (result === content) {
    throw new TextEditError(
      `No changes made to ${displayPath}. The replacement produced identical content.`,
    );
  }
  return result;
}

/** Whole-file apply: strip BOM, match on LF, restore the file's line endings and BOM. */
export function applyTextEditsToFileText(
  raw: string,
  edits: readonly TextEdit[],
  displayPath: string,
): string {
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const text = bom ? raw.slice(1) : raw;
  const ending = detectLineEnding(text);
  const updated = applyTextEditsToNormalized(normalizeToLF(text), edits, displayPath);
  return bom + (ending === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated);
}
