/**
 * Render the `code_search` tool result shown to the main agent.
 *
 * The framing is copied verbatim from recorded Devin tool results
 * (docs/research/2026-09-19-devin-code-search-verified.md §4): a command list,
 * a bridge sentence, then `<file path="…" total_lines=N>` blocks whose bodies
 * are `LINE|TEXT` with right-aligned line numbers.
 */
import type { CodeSearchAnswerFile } from './answer-parse.js';
import { truncateLine } from './command-output.js';

/** Header line, verbatim from the verified tool result. */
const FRAMING_HEADER = 'A search subagent explored the codebase, running these commands:';

/** Bridge sentence, verbatim from the verified tool result (em dashes included). */
const FRAMING_BRIDGE =
  'It believes the snippets below are relevant to your search. Be careful evaluating their relevance — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed:';

/** Verbatim empty-result sentence. */
export const CODE_SEARCH_NO_RESULTS =
  'Fast-context search did not find relevant code. Verify with your normal grep/glob/read tools.';

/** Verbatim notice for an answer with no usable ranges. */
export const CODE_SEARCH_NO_RANGES =
  'Fast-context search did not return any file ranges. Raw response:';

/**
 * Snippet lines rendered across all files in one result. piwin's own guard:
 * recorded Devin results were 6–12k characters, so this leaves headroom while
 * keeping the main agent's context bounded.
 */
export const DEFAULT_CODE_SEARCH_SNIPPET_LINE_BUDGET = 500;

/** Reads a file's lines for snippet rendering; undefined when unreadable. */
export type CodeSearchLineReader = (absolutePath: string) => Promise<string[] | undefined>;

export type FormatCodeSearchResultInput = {
  /** Framing lines from the executed restricted commands, in round order. */
  commandSummaries: readonly string[];
  files: readonly CodeSearchAnswerFile[];
  /** Devin's verified framing always carries snippets; false switches to a path/range list. */
  includeSnippets: boolean;
  /** Per-line character cap for rendered snippets. */
  lineMaxChars: number;
  snippetLineBudget?: number;
  readLines: CodeSearchLineReader;
};

/** Right-align line numbers to the width of the file's largest line number. */
function lineNumberPrefix(lineNumber: number, width: number): string {
  return String(lineNumber).padStart(width, ' ');
}

function renderRangeAnnotation(file: CodeSearchAnswerFile): string {
  return file.ranges.map((range) => `L${range.start}-${range.end}`).join(', ');
}

/**
 * Devin's snippet block: the whole file's ranges inside one `<file>` element,
 * with a shared line-number width derived from `total_lines`.
 */
async function renderFileBlock(
  file: CodeSearchAnswerFile,
  input: FormatCodeSearchResultInput,
  budget: { remaining: number },
): Promise<string> {
  const lines = await input.readLines(file.absolutePath);
  if (!lines) {
    return `<file path="${file.path}" total_lines=0>\n(unreadable)\n</file>`;
  }
  const totalLines = lines.length;
  const width = String(totalLines).length;
  const body: string[] = [];
  let truncated = 0;

  for (const range of file.ranges) {
    for (let lineNumber = range.start; lineNumber <= range.end; lineNumber += 1) {
      if (lineNumber > totalLines) {
        break;
      }
      if (budget.remaining <= 0) {
        truncated += 1;
        continue;
      }
      budget.remaining -= 1;
      const text = lines[lineNumber - 1] ?? '';
      body.push(`${lineNumberPrefix(lineNumber, width)}|${truncateLine(text, input.lineMaxChars)}`);
    }
  }

  if (truncated > 0) {
    body.push(`… (${truncated} lines truncated)`);
  }
  return `<file path="${file.path}" total_lines=${totalLines}>\n${body.join('\n')}\n</file>`;
}

/**
 * Render a successful search result.
 *
 * Order matters and is part of the observed contract: header, `- <command>`
 * lines, blank line, bridge sentence, blank line, file blocks.
 */
export async function formatCodeSearchResult(input: FormatCodeSearchResultInput): Promise<string> {
  const parts: string[] = [FRAMING_HEADER];
  for (const summary of input.commandSummaries) {
    parts.push(`- ${summary}`);
  }
  parts.push('');

  if (!input.includeSnippets) {
    parts.push(FRAMING_BRIDGE);
    parts.push('');
    for (const file of input.files) {
      parts.push(`  ${file.path} (${renderRangeAnnotation(file)})`);
    }
    return parts.join('\n');
  }

  parts.push(FRAMING_BRIDGE);
  parts.push('');
  const budget = {
    remaining: input.snippetLineBudget ?? DEFAULT_CODE_SEARCH_SNIPPET_LINE_BUDGET,
  };
  for (const file of input.files) {
    parts.push(await renderFileBlock(file, input, budget));
  }
  return parts.join('\n');
}

/**
 * Render the "nothing relevant" result. `rejectedPaths` are surfaced (rather
 * than silently dropped) because they usually mean the subagent drifted out
 * of the search root and the main agent should re-scope its request.
 */
export function formatCodeSearchNoResults(rejectedPaths: readonly string[] = []): string {
  const parts = [CODE_SEARCH_NO_RESULTS];
  if (rejectedPaths.length) {
    parts.push('', `Refused paths outside the search root: ${rejectedPaths.join(', ')}`);
  }
  return parts.join('\n');
}

/** Render the case where the subagent answered without any usable ranges. */
export function formatCodeSearchNoRanges(rawResponse: string): string {
  const trimmed = rawResponse.trim();
  const preview = trimmed.length > 500 ? `${trimmed.slice(0, 500)}… (truncated)` : trimmed;
  return [CODE_SEARCH_NO_RANGES, preview].filter(Boolean).join('\n');
}
