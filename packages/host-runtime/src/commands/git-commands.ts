/**
 * Host IPC handlers: git.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import { createGitService } from '@piwin/git';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'git/status',
  'git/branch-list',
  'git/diff-summary',
  'git/diff-file',
  'git/log-graph',
  'git/stage',
  'git/unstage',
  'git/commit',
  'git/branch-create',
  'git/checkout',
]);

export function isGitCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handleGitCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'git/status': {
          const git = createGitService();
          const snapshot = await git.getStatus(command.projectPath);
          return ok(requestId, 'git/status', { snapshot });
        }
        case 'git/branch-list': {
          const git = createGitService();
          const branches = await git.listBranches(
            command.projectPath,
            typeof command.limit === 'number' ? command.limit : undefined,
          );
          return ok(requestId, 'git/branch-list', { branches });
        }
        case 'git/diff-summary': {
          const git = createGitService();
          const summary = await git.getDiffSummary(command.projectPath);
          return ok(requestId, 'git/diff-summary', { summary });
        }
        case 'git/diff-file': {
          const git = createGitService();
          try {
            const diff = await git.getFileDiff(
              command.projectPath,
              command.path,
              command.scope,
            );
            return ok(requestId, 'git/diff-file', { diff });
          } catch (error) {
            const message = formatError(error);
            return fail(requestId, 'git/diff-file', message);
          }
        }
        case 'git/log-graph': {
          const git = createGitService();
          const graph = await git.getCommitGraph(
            command.projectPath,
            typeof command.limit === 'number' ? command.limit : undefined,
          );
          return ok(requestId, 'git/log-graph', { graph });
        }
        case 'git/stage': {
          const git = createGitService();
          const result = await git.stage(command.input);
          return ok(requestId, 'git/stage', { result });
        }
        case 'git/unstage': {
          const git = createGitService();
          const result = await git.unstage(command.input);
          return ok(requestId, 'git/unstage', { result });
        }
        case 'git/commit': {
          const git = createGitService();
          const result = await git.commit(command.input);
          return ok(requestId, 'git/commit', { result });
        }
        case 'git/branch-create': {
          const git = createGitService();
          const result = await git.createBranch(command.input);
          return ok(requestId, 'git/branch-create', { result });
        }
        case 'git/checkout': {
          const git = createGitService();
          const result = await git.checkout(command.input);
          return ok(requestId, 'git/checkout', { result });
        }
    default:
      return null;
  }
}
