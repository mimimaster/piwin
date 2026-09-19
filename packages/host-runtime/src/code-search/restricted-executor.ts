/**
 * `restricted_exec` executor: the only filesystem access the `code_search`
 * search subagent has.
 *
 * Command shape and limits come from the verified Devin contract
 * (docs/research/2026-09-19-devin-code-search-verified.md §5, §7). Command
 * *outputs* are not observable in the recorded sessions (the structured
 * `steps[]` array never fills in the final update), so outputs use the same
 * `LINE|TEXT` convention as the verified final framing, which is what the
 * subagent needs in order to cite `<range>` values.
 *
 * Pure Node: no ripgrep binary dependency, so the search subagent works on
 * every platform piwin targets. `rg` semantics (regex, include/exclude globs,
 * line-bounded output) are preserved.
 *
 * Directory discovery lives in `codebase-walk.ts`; output caps and numbering
 * live in `command-output.ts`.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { globMatch, matchesAnyGlob } from '../glob-match.js';
import {
  CODE_SEARCH_VIRTUAL_ROOT,
  describePathFailure,
  resolveVirtualPath,
} from './codebase-paths.js';
import { walk, type WalkedFile } from './codebase-walk.js';
import { renderTreeLines } from './tree-render.js';
import {
  boundLines,
  capPlainLines,
  numberedLine,
  splitContentLines,
  summarizeVirtualPath,
} from './command-output.js';

/** Files larger than this are skipped by `rg` (mirrors ripgrep's practicality). */
const MAX_SCANNED_FILE_BYTES = 512 * 1024;

/** Binary sniff window; matches `codebase-walk`'s heuristic. */
const BINARY_SNIFF_BYTES = 1_024;

export type CodeSearchRgCommand = {
  type: 'rg';
  pattern: string;
  path: string;
  include?: string[];
  exclude?: string[];
};

export type CodeSearchReadFileCommand = {
  type: 'readfile';
  file: string;
  start_line?: number;
  end_line?: number;
};

export type CodeSearchTreeCommand = {
  type: 'tree';
  path: string;
  levels?: number;
};

export type CodeSearchLsCommand = {
  type: 'ls';
  path: string;
  long_format?: boolean;
  all?: boolean;
};

export type CodeSearchGlobCommand = {
  type: 'glob';
  pattern: string;
  path: string;
  type_filter?: 'file' | 'directory' | 'all';
};

/** One `restricted_exec` sub-command. */
export type CodeSearchRestrictedCommand =
  | CodeSearchRgCommand
  | CodeSearchReadFileCommand
  | CodeSearchTreeCommand
  | CodeSearchLsCommand
  | CodeSearchGlobCommand;

/** Executed command: framing summary plus the output fed back to the subagent. */
export type CodeSearchCommandOutcome = {
  type: CodeSearchRestrictedCommand['type'];
  /** Framing line body, e.g. `Grepped ADR in .` — see the verified result framing. */
  summary: string;
  output: string;
  /** Set by failed commands so the loop can report them without aborting the round. */
  error?: string;
};

export type RestrictedExecutorOptions = {
  /** Real search root; every virtual path is mapped inside it. */
  root: string;
  /** Output line cap per command. */
  resultMaxLines: number;
  /** Per-line character cap. */
  lineMaxChars: number;
  /** Repo-relative globs never walked. */
  excludePaths: readonly string[];
};

export type RestrictedExecutor = {
  /** Run commands in parallel, preserving order. */
  executeAll(
    commands: readonly CodeSearchRestrictedCommand[],
  ): Promise<CodeSearchCommandOutcome[]>;
  /** Patterns the subagent actually searched for, deduped, in first-seen order. */
  collectedRgPatterns(): string[];
};

function isProbablyBinary(buffer: Buffer): boolean {
  const sniff = buffer.subarray(0, BINARY_SNIFF_BYTES);
  return sniff.includes(0);
}

/** Map a command path, returning either the absolute path or a failure message. */
function mapCommandPath(
  root: string,
  virtualPath: string,
  kind: string,
): { ok: true; absolutePath: string; virtualPath: string } | { ok: false; message: string } {
  const mapped = resolveVirtualPath(root, virtualPath);
  if (!mapped.ok) {
    return { ok: false, message: describePathFailure(kind, mapped.failure, mapped.value) };
  }
  return { ok: true, absolutePath: mapped.absolutePath, virtualPath };
}

/**
 * Create an executor bound to one search root. The returned object is
 * per-call: `collectedRgPatterns` accumulates across `executeAll` invocations
 * so one search can report the keywords it used.
 */
export function createRestrictedExecutor(options: RestrictedExecutorOptions): RestrictedExecutor {
  const root = resolve(options.root);
  const collected: string[] = [];

  async function runRg(
    command: CodeSearchRgCommand,
    excludeForCommand: readonly string[],
  ): Promise<CodeSearchCommandOutcome> {
    const summaryTarget = summarizeVirtualPath(command.path);
    const summary = `Grepped ${command.pattern} in ${summaryTarget}`;
    const mapped = mapCommandPath(root, command.path, 'rg path');
    if (!mapped.ok) {
      return { type: 'rg', summary, output: mapped.message, error: mapped.message };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(command.pattern);
    } catch (error) {
      const message = `Error: invalid rg pattern ${JSON.stringify(command.pattern)}: ${
        error instanceof Error ? error.message : 'unknown'
      }`;
      return { type: 'rg', summary, output: message, error: message };
    }

    collected.push(command.pattern);

    const includeGlobs = command.include ?? [];
    const excludeGlobs = [...excludeForCommand, ...(command.exclude ?? [])];
    const walked = await walk(root, mapped.absolutePath, excludeGlobs);

    const lines: string[] = [];
    for (const file of walked.files) {
      if (includeGlobs.length && !matchesAnyGlob(file.relativePath, includeGlobs)) {
        continue;
      }
      let buffer: Buffer;
      try {
        const fileStat = await stat(file.absolutePath);
        if (fileStat.size > MAX_SCANNED_FILE_BYTES) {
          continue;
        }
        buffer = await readFile(file.absolutePath);
      } catch {
        continue;
      }
      if (isProbablyBinary(buffer)) {
        continue;
      }
      const fileLines = splitContentLines(buffer.toString('utf-8'));
      for (let index = 0; index < fileLines.length; index += 1) {
        const text = fileLines[index] ?? '';
        if (regex.test(text)) {
          lines.push(numberedLine(`${file.relativePath}:${index + 1}`, text, options.lineMaxChars));
        }
      }
      if (lines.length > options.resultMaxLines) {
        break;
      }
    }

    if (!lines.length) {
      return { type: 'rg', summary, output: 'No matches.' };
    }
    return { type: 'rg', summary, output: boundLines(lines, options.resultMaxLines) };
  }

  async function runReadFile(command: CodeSearchReadFileCommand): Promise<CodeSearchCommandOutcome> {
    const summaryTarget = summarizeVirtualPath(command.file);
    const summary = `Read ${summaryTarget}`;
    const mapped = mapCommandPath(root, command.file, 'file path');
    if (!mapped.ok) {
      return { type: 'readfile', summary, output: mapped.message, error: mapped.message };
    }
    let content: string;
    try {
      content = await readFile(mapped.absolutePath, 'utf-8');
    } catch (error) {
      const message = `Error: cannot read ${summaryTarget}: ${
        error instanceof Error ? error.message : 'unknown'
      }`;
      return { type: 'readfile', summary, output: message, error: message };
    }
    const fileLines = splitContentLines(content);
    const total = fileLines.length;
    const requestedStart = Number.isFinite(command.start_line) ? Math.trunc(command.start_line as number) : 1;
    const start = Math.max(1, requestedStart);
    const requestedEnd = Number.isFinite(command.end_line) ? Math.trunc(command.end_line as number) : total;
    const end = Math.min(total, requestedEnd);
    if (start > total) {
      const message = `Error: start_line ${start} beyond end of ${summaryTarget} (${total} lines)`;
      return { type: 'readfile', summary, output: message, error: message };
    }
    const selected: string[] = [];
    for (let line = start; line <= end; line += 1) {
      selected.push(numberedLine(String(line), fileLines[line - 1] ?? '', options.lineMaxChars));
    }
    return {
      type: 'readfile',
      summary,
      output: boundLines(selected, options.resultMaxLines),
    };
  }

  async function runTree(
    command: CodeSearchTreeCommand,
    excludeForCommand: readonly string[],
  ): Promise<CodeSearchCommandOutcome> {
    const summaryTarget = summarizeVirtualPath(command.path);
    const summary = `Analysed ${summaryTarget}`;
    const mapped = mapCommandPath(root, command.path, 'tree path');
    if (!mapped.ok) {
      return { type: 'tree', summary, output: mapped.message, error: mapped.message };
    }
    const requestedLevels = Number.isFinite(command.levels) ? Math.trunc(command.levels as number) : 2;
    const { lines } = await renderTreeLines({
      root,
      startAbsolute: mapped.absolutePath,
      label: command.path,
      levels: Math.max(1, Math.min(6, requestedLevels)),
      excludePaths: excludeForCommand,
      maxLines: options.resultMaxLines + 1,
    });
    return { type: 'tree', summary, output: capPlainLines(lines, options.resultMaxLines, options.lineMaxChars) };
  }

  async function runLs(
    command: CodeSearchLsCommand,
    excludeForCommand: readonly string[],
  ): Promise<CodeSearchCommandOutcome> {
    const summaryTarget = summarizeVirtualPath(command.path);
    const summary = `Listed ${summaryTarget}`;
    const mapped = mapCommandPath(root, command.path, 'ls path');
    if (!mapped.ok) {
      return { type: 'ls', summary, output: mapped.message, error: mapped.message };
    }
    let entries;
    try {
      entries = await readdir(mapped.absolutePath, { withFileTypes: true });
    } catch (error) {
      const message = `Error: cannot list ${summaryTarget}: ${
        error instanceof Error ? error.message : 'unknown'
      }`;
      return { type: 'ls', summary, output: message, error: message };
    }
    const selected = entries
      .filter((entry) => (command.all ? true : !entry.name.startsWith('.')))
      .filter((entry) => {
        const absolutePath = join(mapped.absolutePath, entry.name);
        const rel = relative(resolve(root), absolutePath).replace(/\\/g, '/');
        return !matchesAnyGlob(rel, excludeForCommand);
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const lines: string[] = [];
    for (const entry of selected) {
      const marker = entry.isDirectory() ? '/' : '';
      if (command.long_format) {
        let size = 0;
        if (entry.isFile()) {
          try {
            size = (await stat(join(mapped.absolutePath, entry.name))).size;
          } catch {
            size = 0;
          }
        }
        lines.push(`${size}\t${entry.name}${marker}`);
      } else {
        lines.push(`${entry.name}${marker}`);
      }
    }
    if (!lines.length) {
      return { type: 'ls', summary, output: 'Empty directory.' };
    }
    return { type: 'ls', summary, output: capPlainLines(lines, options.resultMaxLines, options.lineMaxChars) };
  }

  async function runGlob(
    command: CodeSearchGlobCommand,
    excludeForCommand: readonly string[],
  ): Promise<CodeSearchCommandOutcome> {
    const summaryTarget = summarizeVirtualPath(command.path);
    const summary = `Searched ${command.pattern} in ${summaryTarget}`;
    const mapped = mapCommandPath(root, command.path, 'glob path');
    if (!mapped.ok) {
      return { type: 'glob', summary, output: mapped.message, error: mapped.message };
    }
    const typeFilter = command.type_filter ?? 'file';
    const wantsDirectories = typeFilter === 'directory' || typeFilter === 'all';
    const walked = await walk(root, mapped.absolutePath, excludeForCommand, {
      directories: wantsDirectories,
    });
    const baseRelative = relative(resolve(root), mapped.absolutePath).replace(/\\/g, '/');
    const prefix = baseRelative && baseRelative !== '.' ? `${baseRelative}/` : '';

    const matches: string[] = [];
    if (typeFilter === 'file' || typeFilter === 'all') {
      for (const file of walked.files) {
        const candidate = prefix && file.relativePath.startsWith(prefix)
          ? file.relativePath.slice(prefix.length)
          : file.relativePath;
        if (globMatch(candidate, command.pattern) || globMatch(file.relativePath, command.pattern)) {
          matches.push(file.relativePath);
        }
      }
    }
    if (wantsDirectories) {
      for (const directory of walked.directories) {
        const candidate = prefix && directory.startsWith(prefix)
          ? directory.slice(prefix.length)
          : directory;
        if (globMatch(candidate, command.pattern) || globMatch(directory, command.pattern)) {
          matches.push(`${directory}/`);
        }
      }
    }
    matches.sort((a, b) => a.localeCompare(b));

    if (!matches.length) {
      return { type: 'glob', summary, output: 'No matches.' };
    }
    return { type: 'glob', summary, output: capPlainLines(matches, options.resultMaxLines, options.lineMaxChars) };
  }

  return {
    async executeAll(commands) {
      const excludeForCommand = [...options.excludePaths];
      return Promise.all(
        commands.map((command) => {
          switch (command.type) {
            case 'rg':
              return runRg(command, excludeForCommand);
            case 'readfile':
              return runReadFile(command);
            case 'tree':
              return runTree(command, excludeForCommand);
            case 'ls':
              return runLs(command, excludeForCommand);
            case 'glob':
              return runGlob(command, excludeForCommand);
            default:
              return Promise.resolve<CodeSearchCommandOutcome>({
                type: (command as CodeSearchRestrictedCommand).type,
                summary: 'Unknown command',
                output: 'Error: unsupported command type',
                error: 'Error: unsupported command type',
              });
          }
        }),
      );
    },
    collectedRgPatterns() {
      return [...new Set(collected)].filter((pattern) => pattern.length >= 3);
    },
  };
}

/** Re-exported so callers building framing lines do not re-derive the rule. */
export { summarizeVirtualPath } from './command-output.js';
export type { WalkedFile };
