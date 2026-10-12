/**
 * What a file write would change, computed before the user is asked, so the
 * permission prompt can show a diff instead of only a path. Display only:
 * any failure (unreadable file, edit that does not apply, huge file) just
 * means no preview — the tool itself still runs and reports its own errors.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { PermissionProposedChange } from '@piwin/contracts';
import { applyTextEditsToFileText, normalizeEditArguments } from './text-edits.js';

/** Files larger than this are not diffed for a prompt. */
const MAX_PREVIEW_FILE_BYTES = 512 * 1024;
/** Keep the request push bounded; the counts still cover the whole change. */
export const MAX_PREVIEW_PATCH_CHARS = 16_000;
/** Line-diff work budget (old × new lines of the changed middle). */
const MAX_DIFF_CELLS = 2_000_000;
const CONTEXT = 3;

export async function buildProposedChange(input: {
  toolName: string;
  arguments: Record<string, unknown>;
  projectPath?: string;
}): Promise<PermissionProposedChange | undefined> {
  try {
    const rawPath = input.arguments.path ?? input.arguments.file_path;
    if (typeof rawPath !== 'string' || rawPath.length === 0) return undefined;
    const absolute = isAbsolute(rawPath) ? rawPath : resolve(input.projectPath ?? process.cwd(), rawPath);
    const before = await readCurrent(absolute);
    if (before === null && input.toolName === 'edit') return undefined;
    let after: string;
    if (input.toolName === 'write_file') {
      const content = input.arguments.content;
      if (typeof content !== 'string') return undefined;
      after = content;
    } else if (input.toolName === 'edit') {
      const normalized = normalizeEditArguments(input.arguments);
      if (!normalized.ok) return undefined;
      after = applyTextEditsToFileText(before ?? '', normalized.edits, rawPath);
    } else {
      return undefined;
    }
    if (Buffer.byteLength(after) > MAX_PREVIEW_FILE_BYTES) return undefined;
    const diff = unifiedDiff(before ?? '', after, rawPath, before === null);
    if (diff === undefined) return undefined;
    const truncated = diff.patch.length > MAX_PREVIEW_PATCH_CHARS;
    return {
      path: rawPath,
      patch: truncated ? `${diff.patch.slice(0, diff.patch.lastIndexOf('\n', MAX_PREVIEW_PATCH_CHARS))}\n` : diff.patch,
      additions: diff.additions,
      deletions: diff.deletions,
      ...(truncated ? { truncated: true } : {}),
    };
  } catch {
    return undefined;
  }
}

async function readCurrent(path: string): Promise<string | null> {
  try {
    const buffer = await readFile(path);
    if (buffer.byteLength > MAX_PREVIEW_FILE_BYTES || buffer.includes(0)) throw new Error('not previewable');
    return buffer.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

type Op = { kind: ' ' | '-' | '+'; text: string };

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Line ops for the changed middle: LCS when affordable, else replace-all. */
function diffMiddle(a: readonly string[], b: readonly string[]): Op[] {
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [...a.map((text) => ({ kind: '-' as const, text })), ...b.map((text) => ({ kind: '+' as const, text }))];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ kind: '-', text: a[i] ?? '' });
      i += 1;
    } else {
      ops.push({ kind: '+', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < a.length) ops.push({ kind: '-', text: a[i++] ?? '' });
  while (j < b.length) ops.push({ kind: '+', text: b[j++] ?? '' });
  return ops;
}

/** A unified diff with `CONTEXT` lines around each change; undefined when nothing changes. */
export function unifiedDiff(
  before: string,
  after: string,
  label: string,
  created = false,
): { patch: string; additions: number; deletions: number } | undefined {
  const a = splitLines(before);
  const b = splitLines(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1;
  }
  const ops: Op[] = [
    ...a.slice(0, prefix).map((text) => ({ kind: ' ' as const, text })),
    ...diffMiddle(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...a.slice(a.length - suffix).map((text) => ({ kind: ' ' as const, text })),
  ];
  const additions = ops.filter((op) => op.kind === '+').length;
  const deletions = ops.filter((op) => op.kind === '-').length;
  if (additions === 0 && deletions === 0) return undefined;

  const out = [created ? '--- /dev/null' : `--- a/${label}`, `+++ b/${label}`];
  let index = 0;
  let oldLine = 1;
  let newLine = 1;
  while (index < ops.length) {
    // Skip to the next change, keeping CONTEXT lines before it.
    let next = index;
    while (next < ops.length && ops[next]?.kind === ' ') next += 1;
    if (next >= ops.length) break;
    const start = Math.max(index, next - CONTEXT);
    for (let k = index; k < start; k += 1) {
      oldLine += 1;
      newLine += 1;
    }
    // Extend the hunk while changes are within 2×CONTEXT of each other.
    let end = next;
    let lastChange = next;
    while (end < ops.length && end - lastChange <= CONTEXT * 2) {
      if (ops[end]?.kind !== ' ') lastChange = end;
      end += 1;
    }
    end = Math.min(ops.length, lastChange + CONTEXT + 1);
    const hunk = ops.slice(start, end);
    const oldCount = hunk.filter((op) => op.kind !== '+').length;
    const newCount = hunk.filter((op) => op.kind !== '-').length;
    out.push(`@@ -${oldCount === 0 ? oldLine - 1 : oldLine},${oldCount} +${newCount === 0 ? newLine - 1 : newLine},${newCount} @@`);
    for (const op of hunk) out.push(`${op.kind}${op.text}`);
    oldLine += oldCount;
    newLine += newCount;
    index = end;
  }
  return { patch: `${out.join('\n')}\n`, additions, deletions };
}
