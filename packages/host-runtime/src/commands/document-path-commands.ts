/**
 * `preview/resolve-path` — the Host's single interpretation of a clicked path
 * (ADR 0052 §6).
 *
 * The command answers with a logical `DocumentTargetRef` or with a specific
 * reason plus the routes that were tried. It adds no read authority of its own:
 * the project branch goes through the same registered browse root as
 * `project/read-file`, and the vault/config branches reuse the existing
 * containment rules.
 */
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { DocumentPathResolveData, HostCommand, HostResponse } from '@piwin/contracts';
import { formatError, PROJECT_FIND_FILE_MAX_MATCHES } from '@piwin/contracts';
import { getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import {
  resolveDocumentPath,
  type DocumentPathResolutionDeps,
  type FindProjectFileOutcome,
} from '../document-path-resolution.js';
import { normalizeProjectFileQuery, searchProjectFiles } from './project-file-search.js';
import { resolveBrowseRoot } from './project-commands.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>(['preview/resolve-path']);

export function isDocumentPathCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleDocumentPathCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: Pick<HostCommandContext, 'piwinRoot' | 'requireSession'>,
): Promise<HostResponse | null> {
  if (!isDocumentPathCommand(command)) {
    return null;
  }
  if (command.type !== 'preview/resolve-path') {
    return null;
  }

  const sessionId = command.input.sessionId?.trim();
  if (sessionId) {
    try {
      context.requireSession(sessionId);
    } catch (error) {
      return fail(requestId, 'preview/resolve-path', formatError(error));
    }
  }

  const piwinRoot = getPiwinRoot(context.piwinRoot);
  const deps: DocumentPathResolutionDeps = {
    piwinRoot,
    homeDir: homedir(),
    realpath: realpathOrNull,
    isFile: isRegularFile,
    findProjectFile: (input) =>
      findProjectFileInBrowseRoot({
        projectPath: input.projectPath,
        query: input.query,
        piwinRoot: context.piwinRoot,
      }),
  };

  const data: DocumentPathResolveData = await resolveDocumentPath(
    {
      rawPath: command.input.rawPath,
      ...(command.input.projectPath ? { projectPath: command.input.projectPath } : {}),
    },
    deps,
  );
  return ok(requestId, 'preview/resolve-path', data);
}

async function realpathOrNull(absolutePath: string): Promise<string | null> {
  try {
    return await realpath(absolutePath);
  } catch {
    return null;
  }
}

async function isRegularFile(absolutePath: string): Promise<boolean> {
  const real = await realpathOrNull(absolutePath);
  if (real === null) {
    return false;
  }
  try {
    return (await stat(real)).isFile();
  } catch {
    return false;
  }
}

/**
 * Bounded search inside the workspace, used only after the project branch
 * matched but the exact path was not on disk. Never guesses: several matches
 * are reported as such and an incomplete walk resolves nothing.
 */
async function findProjectFileInBrowseRoot(input: {
  projectPath: string;
  query: string;
  piwinRoot: string | undefined;
}): Promise<FindProjectFileOutcome> {
  const root = await resolveBrowseRoot({
    projectPath: input.projectPath,
    piwinRoot: input.piwinRoot,
  });
  if (!root.ok) {
    return root.error === 'project-root-missing' ? { kind: 'root-missing' } : { kind: 'none' };
  }
  const query = normalizeProjectFileQuery(input.query ?? '');
  if (!query || query.includes('..')) {
    return { kind: 'none' };
  }
  const result = await searchProjectFiles({
    rootAbsolute: root.rootAbsolute,
    query,
    maxMatches: PROJECT_FIND_FILE_MAX_MATCHES,
  });
  const relativePaths = result.matches
    .map((match) => match.relativePath)
    .filter((relativePath) => relativePath.length > 0);
  if (relativePaths.length === 0) {
    return { kind: 'none' };
  }
  if (result.truncated === true || relativePaths.length > 1) {
    return { kind: 'ambiguous', relativePaths };
  }
  const [only] = relativePaths;
  return only ? { kind: 'unique', relativePath: only } : { kind: 'none' };
}
