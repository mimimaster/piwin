/**
 * Host-owned `edit`: targeted exact-text replacement under the write gate.
 *
 * Registered under Pi's own tool name with Pi's schema and wording, so it
 * overrides the native tool the way Host `bash` does and models use the
 * format they are prompted with. Pi's native edit (or its operation-seam
 * factory) would do the read–match–write in the worker, between two proxied
 * calls; here the match runs against the bytes on disk inside the file lock,
 * which is what keeps concurrent sessions from clobbering each other.
 */
import { readFile, writeFile } from 'node:fs/promises';

import type { HostToolRegistration } from '@piwin/contracts';
import { writeTurnChangeFile } from '@piwin/git';
import type { BuildHostFilesystemToolsOptions } from './host-filesystem-tools.js';
import { runWithWorkspaceWriteGate } from './run-with-workspace-write-gate.js';
import { applyTextEditsToFileText, normalizeEditArguments, TextEditError } from './text-edits.js';
import { toTurnChangeRelativePath } from './turn-change-path.js';

const utf8 = new TextEncoder();

export function buildHostEditTool(options: {
  resolvePath: (path: string) => string;
  turnChange?: BuildHostFilesystemToolsOptions['turnChange'];
  workspaceWrite?: BuildHostFilesystemToolsOptions['workspaceWrite'];
}): HostToolRegistration {
  const { resolvePath, turnChange, workspaceWrite } = options;
  return {
    descriptor: {
      name: 'edit',
      description:
        'Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes. Prefer this over rewriting the file or editing it through bash.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit (relative or absolute)' },
          edits: {
            type: 'array',
            description:
              'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
            items: {
              type: 'object',
              properties: {
                oldText: {
                  type: 'string',
                  description:
                    'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
                },
                newText: { type: 'string', description: 'Replacement text for this targeted edit.' },
              },
              required: ['oldText', 'newText'],
            },
          },
        },
        required: ['path', 'edits'],
      },
    },
    family: 'filesystem-write',
    permissionSpec: {
      action: 'file-write',
      risk: 'file-write',
      rememberable: true,
      subjectBuilder: (args) => ({ kind: 'file-write', path: String(args.path ?? '') }),
    },
    fileEffect: {
      kind: 'exact-paths',
      pathsFromArgs: (args) => [String(args.path)],
    },
    prepareArgs: (rawArguments, _context, signal) => {
      if (signal.aborted) {
        return { ok: false, result: { ok: false, code: 'aborted', message: 'tool preparation aborted' } };
      }
      const normalized = normalizeEditArguments(rawArguments);
      if (!normalized.ok) {
        return { ok: false, result: { ok: false, code: 'invalid-input', message: normalized.message } };
      }
      return {
        ok: true,
        arguments: { path: resolvePath(normalized.path), edits: normalized.edits },
      };
    },
    async execute(args, signal, context) {
      const filePath = String(args.path ?? '');
      const normalized = normalizeEditArguments(args);
      if (!normalized.ok) {
        return { ok: false, code: 'invalid-input', message: normalized.message };
      }
      return runWithWorkspaceWriteGate({
        workspaceWrite,
        runId: context.runId,
        ownerId: context.sessionId,
        signal,
        mode: 'shared',
        wait: true,
        filePath,
        foreignChangeCheck: false,
        run: async () => {
          let raw: string;
          try {
            raw = await readFile(filePath, 'utf-8');
          } catch (error) {
            const code = (error as { code?: unknown }).code;
            return {
              ok: false,
              code: 'execution-failed',
              message: `Could not edit file: ${filePath}. ${
                code === 'ENOENT' ? 'File not found; use write_file to create it.' : String(code ?? error)
              }`,
            };
          }
          let next: string;
          try {
            next = applyTextEditsToFileText(raw, normalized.edits, filePath);
          } catch (error) {
            if (error instanceof TextEditError) {
              return { ok: false, code: 'execution-failed', message: error.message };
            }
            throw error;
          }
          if (signal.aborted) {
            return { ok: false, code: 'aborted', message: 'tool execution aborted' };
          }
          if (turnChange) {
            const receipt = await writeTurnChangeFile({
              workspaceRoot: turnChange.workspaceRoot,
              relativePath: toTurnChangeRelativePath(filePath, turnChange.workspaceRoot),
              bytes: utf8.encode(next),
              store: turnChange.store,
            });
            turnChange.onReceipt?.(receipt);
          } else {
            await writeFile(filePath, next, 'utf-8');
          }
          const count = normalized.edits.length;
          return { ok: true, output: `Successfully replaced ${count} block(s) in ${filePath}.` };
        },
      });
    },
  };
}
