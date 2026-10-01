/**
 * Host-owned `move_file` and `move_lines`: moving code between files without
 * quoting it, under the write gate and the turn-change recorder.
 *
 * `edit` and `write_file` cover changes that quote their text. Splitting a
 * large file quotes the same block twice (once to remove it, once to write it
 * elsewhere), and renaming has no tool at all — so models fall back to `sed`,
 * `mv` and scripts in a shell, whose changes Host cannot record. These two
 * tools take the range or the path instead, and record what they write like
 * any Host write, so undo covers them.
 */
import { chmod, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { assertWritableTurnChangeFile, deleteTurnChangeFile, writeTurnChangeFile } from '@piwin/git';
import type { BuildHostFilesystemToolsOptions } from './host-filesystem-tools.js';
import { cutLineRange } from './line-range-cut.js';
import { runWithWorkspaceWriteGate } from './run-with-workspace-write-gate.js';
import { toTurnChangeRelativePath } from './turn-change-path.js';

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');

type MoveToolOptions = {
  resolvePath: (path: string) => string;
  turnChange?: BuildHostFilesystemToolsOptions['turnChange'];
  workspaceWrite?: BuildHostFilesystemToolsOptions['workspaceWrite'];
};

type Prepared = { ok: true; arguments: Record<string, unknown> } | { ok: false; result: ToolResult };

const invalid = (message: string): Prepared => ({
  ok: false,
  result: { ok: false, code: 'invalid-input', message },
});

function requiredPath(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function failure(message: string): ToolResult {
  return { ok: false, code: 'execution-failed', message };
}

/** Whole-file reads and writes, recorded for undo when the turn is being recorded. */
function fileAccess(options: MoveToolOptions) {
  const { turnChange } = options;
  return {
    async exists(path: string): Promise<boolean> {
      return stat(path).then(
        () => true,
        () => false,
      );
    },
    async readBytes(path: string): Promise<Uint8Array> {
      return new Uint8Array(await readFile(path));
    },
    async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
      if (!turnChange) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        return;
      }
      const receipt = await writeTurnChangeFile({
        workspaceRoot: turnChange.workspaceRoot,
        relativePath: toTurnChangeRelativePath(path, turnChange.workspaceRoot),
        bytes,
        store: turnChange.store,
      });
      turnChange.onReceipt?.(receipt);
    },
    async remove(path: string): Promise<void> {
      if (!turnChange) {
        await unlink(path);
        return;
      }
      const receipt = await deleteTurnChangeFile({
        workspaceRoot: turnChange.workspaceRoot,
        relativePath: toTurnChangeRelativePath(path, turnChange.workspaceRoot),
        store: turnChange.store,
      });
      turnChange.onReceipt?.(receipt);
    },
    /** Refuse symlinks, directories and paths outside the workspace before writing. */
    async assertRegularOrMissing(path: string): Promise<'file' | 'missing'> {
      if (!turnChange) {
        return (await this.exists(path)) ? 'file' : 'missing';
      }
      const resolved = await assertWritableTurnChangeFile({
        workspaceRoot: turnChange.workspaceRoot,
        relativePath: toTurnChangeRelativePath(path, turnChange.workspaceRoot),
      });
      return resolved.kind === 'file' ? 'file' : 'missing';
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildHostMoveFileTool(options: MoveToolOptions): HostToolRegistration {
  const { resolvePath, workspaceWrite } = options;
  const files = fileAccess(options);
  return {
    descriptor: {
      name: 'move_file',
      description:
        'Move or rename one file. The destination must not exist; its folder is created. Host records both ends so the user can undo the turn, so use this instead of `mv` in a shell. Paths are relative to the session working directory. Subject to permission policy.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Existing file to move (relative or absolute)' },
          to: { type: 'string', description: 'New path; must not exist yet (relative or absolute)' },
        },
        required: ['from', 'to'],
      },
    },
    family: 'filesystem-write',
    permissionSpec: {
      action: 'file-write',
      risk: 'file-write',
      // A remembered rule names one path; a move names two.
      rememberable: false,
      subjectBuilder: (args) => ({
        kind: 'file-paths',
        paths: [String(args.from ?? ''), String(args.to ?? '')],
      }),
    },
    fileEffect: {
      kind: 'exact-paths',
      pathsFromArgs: (args) => [String(args.from), String(args.to)],
    },
    prepareArgs: (rawArguments, _context, signal) => {
      if (signal.aborted) {
        return { ok: false, result: { ok: false, code: 'aborted', message: 'tool preparation aborted' } };
      }
      const from = requiredPath(rawArguments, 'from');
      const to = requiredPath(rawArguments, 'to');
      if (from === undefined || to === undefined) return invalid('from and to are required');
      return { ok: true, arguments: { ...rawArguments, from: resolvePath(from), to: resolvePath(to) } };
    },
    async execute(args, signal, context) {
      const from = String(args.from ?? '');
      const to = String(args.to ?? '');
      if (from === to) return failure('from and to are the same path.');
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        ownerId: context.sessionId,
        signal,
        mode: 'shared',
        wait: true,
        filePath: from,
        extraFilePaths: [to],
        foreignChangeCheck: false,
        run: async () => {
          try {
            if ((await files.assertRegularOrMissing(from)) === 'missing') {
              return failure(`Could not move: ${from} does not exist.`);
            }
            if ((await files.assertRegularOrMissing(to)) === 'file') {
              return failure(
                `Could not move: ${to} already exists. Nothing was changed. Remove it with delete_file or choose another name.`,
              );
            }
          } catch (error) {
            return failure(`Could not move: ${describeError(error)}`);
          }
          if (signal.aborted) return { ok: false, code: 'aborted', message: 'tool execution aborted' };
          let bytes: Uint8Array;
          let mode: number;
          try {
            bytes = await files.readBytes(from);
            mode = (await stat(from)).mode & 0o777;
          } catch (error) {
            return failure(`Could not move: reading ${from} failed (${describeError(error)}).`);
          }
          // Write the copy first: a failure after this leaves both files, never neither.
          try {
            await files.writeBytes(to, bytes);
          } catch (error) {
            return failure(`Could not move: writing ${to} failed (${describeError(error)}). Nothing was changed.`);
          }
          // A new file starts 0644; keep the source's mode so a script stays executable.
          await chmod(to, mode).catch(() => undefined);
          try {
            await files.remove(from);
          } catch (error) {
            return failure(
              `${to} was written but ${from} could not be removed (${describeError(error)}); both exist now.`,
            );
          }
          return { ok: true, output: `Moved ${from} to ${to}.` };
        },
      });
    },
  };
}

export function buildHostMoveLinesTool(options: MoveToolOptions): HostToolRegistration {
  const { resolvePath, workspaceWrite } = options;
  const files = fileAccess(options);
  return {
    descriptor: {
      name: 'move_lines',
      description:
        'Cut a range of whole lines out of a file, optionally appending it to another file (created when missing). Use it to split or reorganise files without quoting the code: give line numbers (find them with `bash`, e.g. `grep -n` or `nl -ba`) plus the first and last line as a check. If a quoted line does not match, nothing changes and the error says where it is. Host records both files so the user can undo the turn. `replacement` is left where the range was (for example an import line); without `to`, this deletes or replaces the range. Subject to permission policy.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'File to cut lines out of (relative or absolute)' },
          startLine: { type: 'number', description: 'First line of the range, 1-based' },
          endLine: { type: 'number', description: 'Last line of the range, 1-based, inclusive' },
          startText: {
            type: 'string',
            description: 'Text of line startLine, to catch a mis-numbered range (indentation ignored)',
          },
          endText: {
            type: 'string',
            description: 'Text of line endLine, to catch a mis-numbered range (indentation ignored)',
          },
          to: {
            type: 'string',
            description: 'File to append the cut lines to; created when missing. Omit to just remove the range.',
          },
          prefix: {
            type: 'string',
            description: 'Text put before the cut lines when `to` is created (for example imports). Ignored when `to` exists.',
          },
          replacement: {
            type: 'string',
            description: 'Text left in `from` where the range was. Default: nothing.',
          },
        },
        required: ['from', 'startLine', 'endLine', 'startText', 'endText'],
      },
    },
    family: 'filesystem-write',
    permissionSpec: {
      action: 'file-write',
      risk: 'file-write',
      rememberable: false,
      subjectBuilder: (args) =>
        typeof args.to === 'string' && args.to !== ''
          ? { kind: 'file-paths', paths: [String(args.from ?? ''), args.to] }
          : { kind: 'file-write', path: String(args.from ?? '') },
    },
    fileEffect: {
      kind: 'exact-paths',
      pathsFromArgs: (args) =>
        typeof args.to === 'string' && args.to !== '' ? [String(args.from), args.to] : [String(args.from)],
    },
    prepareArgs: (rawArguments, _context, signal) => {
      if (signal.aborted) {
        return { ok: false, result: { ok: false, code: 'aborted', message: 'tool preparation aborted' } };
      }
      const from = requiredPath(rawArguments, 'from');
      if (from === undefined) return invalid('from is required');
      const { startLine, endLine, startText, endText, to, prefix, replacement } = rawArguments;
      if (typeof startLine !== 'number' || typeof endLine !== 'number') {
        return invalid('startLine and endLine are required numbers');
      }
      if (typeof startText !== 'string' || typeof endText !== 'string') {
        return invalid('startText and endText are required: the text of the first and last line of the range');
      }
      for (const [name, value] of [['to', to], ['prefix', prefix], ['replacement', replacement]] as const) {
        if (value !== undefined && typeof value !== 'string') return invalid(`${name} must be a string`);
      }
      const target = typeof to === 'string' && to.trim() !== '' ? resolvePath(to.trim()) : undefined;
      return {
        ok: true,
        arguments: {
          from: resolvePath(from),
          startLine,
          endLine,
          startText,
          endText,
          ...(target !== undefined ? { to: target } : {}),
          ...(typeof prefix === 'string' ? { prefix } : {}),
          ...(typeof replacement === 'string' ? { replacement } : {}),
        },
      };
    },
    async execute(args, signal, context) {
      const from = String(args.from ?? '');
      const to = typeof args.to === 'string' ? args.to : undefined;
      if (to === from) return failure('to must differ from from; omit to to just remove the range.');
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        ownerId: context.sessionId,
        signal,
        mode: 'shared',
        wait: true,
        filePath: from,
        ...(to !== undefined ? { extraFilePaths: [to] } : {}),
        foreignChangeCheck: false,
        run: async () => {
          let sourceText: string;
          let destinationText: string | undefined;
          try {
            if ((await files.assertRegularOrMissing(from)) === 'missing') {
              return failure(`Could not cut lines: ${from} does not exist.`);
            }
            sourceText = utf8Decoder.decode(await files.readBytes(from));
            if (to !== undefined && (await files.assertRegularOrMissing(to)) === 'file') {
              destinationText = utf8Decoder.decode(await files.readBytes(to));
            }
          } catch (error) {
            return failure(`Could not cut lines: ${describeError(error)}`);
          }
          const cut = cutLineRange({
            text: sourceText,
            startLine: Number(args.startLine),
            endLine: Number(args.endLine),
            startText: String(args.startText ?? ''),
            endText: String(args.endText ?? ''),
            ...(typeof args.replacement === 'string' ? { replacement: args.replacement } : {}),
          });
          if (!cut.ok) return failure(cut.message);
          if (signal.aborted) return { ok: false, code: 'aborted', message: 'tool execution aborted' };

          // Write the destination first: a failure after this leaves the lines in both files, never neither.
          if (to !== undefined) {
            let next: string;
            if (destinationText === undefined) {
              const prefix = typeof args.prefix === 'string' ? args.prefix : '';
              next = prefix === '' ? cut.block : `${prefix}${prefix.endsWith('\n') ? '' : '\n'}${cut.block}`;
            } else {
              const joiner = destinationText === '' || destinationText.endsWith('\n') ? '' : '\n';
              next = `${destinationText}${joiner}${cut.block}`;
            }
            try {
              await files.writeBytes(to, utf8.encode(next));
            } catch (error) {
              return failure(`Could not cut lines: writing ${to} failed (${describeError(error)}). Nothing was changed.`);
            }
          }
          try {
            await files.writeBytes(from, utf8.encode(cut.remaining));
          } catch (error) {
            return failure(
              `${to ?? 'The destination'} was written but ${from} could not be updated (${describeError(error)}); the lines are in both files now.`,
            );
          }
          const range = `${String(args.startLine)}-${String(args.endLine)}`;
          return {
            ok: true,
            output:
              to === undefined
                ? `Removed lines ${range} (${cut.lineCount} lines) from ${from}.`
                : `Moved lines ${range} (${cut.lineCount} lines) from ${from} to ${to}${destinationText === undefined ? ' (created)' : ''}.`,
          };
        },
      });
    },
  };
}
