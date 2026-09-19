/**
 * Parse the search subagent's final `<ANSWER>` XML into usable files.
 *
 * Observed Devin answer shape (docs/research/2026-09-19-devin-code-search-verified.md §5):
 *
 * ```xml
 * <ANSWER>
 *   <file path="/codebase/src/app.ts">
 *     <range>10-60</range>
 *     <range>150-210</range>
 *   </file>
 * </ANSWER>
 * ```
 *
 * Paths arrive either virtual (`/codebase/…`) or bare-relative; both are
 * validated against the search root. Refused paths are reported rather than
 * dropped silently, and an empty `<ANSWER></ANSWER>` is a valid answer: the
 * subagent is told that returning nothing beats returning irrelevant files.
 */
import { resolve } from 'node:path';
import { toRepoRelativePath } from './codebase-paths.js';

/** Inclusive, 1-indexed line range. */
export type CodeSearchAnswerRange = {
  start: number;
  end: number;
};

/** One file the subagent returned, already validated inside the search root. */
export type CodeSearchAnswerFile = {
  /** Repo-relative path used in the framing shown to the main agent. */
  path: string;
  absolutePath: string;
  ranges: CodeSearchAnswerRange[];
};

export type CodeSearchAnswer = {
  files: CodeSearchAnswerFile[];
  /** Paths the model emitted that were refused (traversal / foreign absolute). */
  rejectedPaths: string[];
  /** True when the `<ANSWER>` element was absent, i.e. the model ignored the protocol. */
  malformed: boolean;
};

const FILE_ELEMENT = /<file\s+path\s*=\s*(["'])([^"']+)\1\s*>([\s\S]*?)<\/file>/g;
const RANGE_ELEMENT = /<range\s*>\s*(\d+)\s*-\s*(\d+)\s*<\/range\s*>/g;
const ANSWER_OPEN = /<ANSWER\b[^>]*>/i;
const ANSWER_CLOSE = /<\/ANSWER\s*>/i;
const HAS_FILE_ELEMENT = /<file\s+path\s*=/i;

/** True when a string looks like the subagent's XML answer, not prose. */
export function looksLikeAnswerXml(value: string): boolean {
  return ANSWER_OPEN.test(value) || HAS_FILE_ELEMENT.test(value);
}

/**
 * Pull XML out of an `answer` tool call, then fall back to the model's
 * text. Custom/chat models often emit `<ANSWER>` as the final response
 * instead of calling the `answer` tool (the prompt says "final response").
 */
export function extractAnswerXml(input: {
  toolArguments?: Record<string, unknown>;
  text?: string;
}): string {
  const fromTool = readAnswerArgument(input.toolArguments);
  if (fromTool.trim()) {
    return fromTool;
  }
  return typeof input.text === 'string' ? input.text : '';
}

function readAnswerArgument(value: Record<string, unknown> | undefined): string {
  if (!value) {
    return '';
  }
  if (typeof value.answer === 'string') {
    return value.answer;
  }
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'string' && looksLikeAnswerXml(candidate)) {
      return candidate;
    }
  }
  return '';
}

/** Body of `<ANSWER>…` even when the closing tag is missing. */
function answerBody(raw: string): { body: string; malformed: boolean } {
  const open = ANSWER_OPEN.exec(raw);
  if (open) {
    const after = raw.slice(open.index + open[0].length);
    const close = ANSWER_CLOSE.exec(after);
    return { body: close ? after.slice(0, close.index) : after, malformed: false };
  }
  if (HAS_FILE_ELEMENT.test(raw)) {
    return { body: raw, malformed: false };
  }
  return { body: '', malformed: true };
}

function parseRanges(body: string): CodeSearchAnswerRange[] {
  const ranges: CodeSearchAnswerRange[] = [];
  RANGE_ELEMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RANGE_ELEMENT.exec(body)) !== null) {
    const first = Number.parseInt(match[1] ?? '', 10);
    const second = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      continue;
    }
    // Line numbers are 1-indexed and inclusive; a reversed or non-positive
    // range is a model slip, not a reason to discard the whole file.
    const start = Math.max(1, Math.min(first, second));
    const end = Math.max(start, Math.max(first, second));
    ranges.push({ start, end });
  }
  return ranges;
}

function dedupeRanges(ranges: readonly CodeSearchAnswerRange[]): CodeSearchAnswerRange[] {
  const seen = new Set<string>();
  const out: CodeSearchAnswerRange[] = [];
  for (const range of ranges) {
    const key = `${range.start}-${range.end}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(range);
  }
  return out;
}

/**
 * Parse the subagent's `answer` tool argument.
 *
 * `maxResults` caps how many files are returned; ranges are kept in the order
 * the model emitted them so the main agent sees the subagent's own priority.
 */
export function parseCodeSearchAnswer(input: {
  root: string;
  answerXml: string;
  maxResults: number;
}): CodeSearchAnswer {
  const { root, answerXml, maxResults } = input;
  const raw = typeof answerXml === 'string' ? answerXml : '';
  const rejectedPaths: string[] = [];
  const extracted = answerBody(raw);

  if (extracted.malformed) {
    return { files: [], rejectedPaths, malformed: true };
  }

  const body = extracted.body;
  const byPath = new Map<string, CodeSearchAnswerFile>();
  FILE_ELEMENT.lastIndex = 0;
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = FILE_ELEMENT.exec(body)) !== null) {
    const declared = (fileMatch[2] ?? '').trim();
    if (!declared) {
      continue;
    }
    const relativePath = toRepoRelativePath(root, declared);
    if (!relativePath) {
      rejectedPaths.push(declared);
      continue;
    }
    const ranges = parseRanges(fileMatch[3] ?? '');
    const existing = byPath.get(relativePath);
    if (existing) {
      existing.ranges = dedupeRanges([...existing.ranges, ...ranges]);
      continue;
    }
    byPath.set(relativePath, {
      path: relativePath,
      absolutePath: resolve(root, relativePath),
      ranges,
    });
  }

  const files = [...byPath.values()]
    .filter((file) => file.ranges.length > 0)
    .slice(0, Math.max(0, maxResults));

  return { files, rejectedPaths, malformed: false };
}
