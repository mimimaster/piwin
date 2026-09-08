/**
 * Host IPC handlers: git.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { createGitService } from '@piwin/git';
import { bindProjectLocatorFromRoot } from '../project-locator.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';
import type { WorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';


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
  'git/stash',
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
  const git = createGitService();
  switch (command.type) {
        case 'git/status': {
          const projectPath = await resolveGitProjectPath(
            command.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          const snapshot = await git.getStatus(projectPath.path);
          return ok(requestId, 'git/status', { snapshot });
        }
        case 'git/branch-list': {
          const projectPath = await resolveGitProjectPath(
            command.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          const branches = await git.listBranches(
            projectPath.path,
            typeof command.limit === 'number' ? command.limit : undefined,
          );
          return ok(requestId, 'git/branch-list', { branches });
        }
        case 'git/diff-summary': {
          const projectPath = await resolveGitProjectPath(
            command.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          const summary = await git.getDiffSummary(projectPath.path);
          return ok(requestId, 'git/diff-summary', { summary });
        }
        case 'git/diff-file': {
          const projectPath = await resolveGitProjectPath(
            command.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          try {
            const diff = await git.getFileDiff(
              projectPath.path,
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
          const projectPath = await resolveGitProjectPath(
            command.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          const graph = await git.getCommitGraph(
            projectPath.path,
            typeof command.limit === 'number' ? command.limit : undefined,
          );
          return ok(requestId, 'git/log-graph', { graph });
        }
        case 'git/stage': {
          const projectPath = await resolveGitProjectPath(
            command.input.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          return withGitWriteGate(context.workspaceWriteGate, projectPath.path, requestId, command.type, async () => {
            const result = await git.stage({ ...command.input, projectPath: projectPath.path });
            return ok(requestId, 'git/stage', { result });
          });
        }
        case 'git/unstage': {
          const projectPath = await resolveGitProjectPath(
            command.input.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          return withGitWriteGate(context.workspaceWriteGate, projectPath.path, requestId, command.type, async () => {
            const result = await git.unstage({ ...command.input, projectPath: projectPath.path });
            return ok(requestId, 'git/unstage', { result });
          });
        }
        case 'git/commit': {
          const projectPath = await resolveGitProjectPath(
            command.input.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          return withGitWriteGate(context.workspaceWriteGate, projectPath.path, requestId, command.type, async () => {
            const result = await git.commit({ ...command.input, projectPath: projectPath.path });
            return ok(requestId, 'git/commit', { result });
          });
        }
        case 'git/branch-create': {
          const projectPath = await resolveGitProjectPath(
            command.input.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          return withGitWriteGate(context.workspaceWriteGate, projectPath.path, requestId, command.type, async () => {
            const result = await git.createBranch({ ...command.input, projectPath: projectPath.path });
            return ok(requestId, 'git/branch-create', { result });
          });
        }
        case 'git/checkout': {
          const projectPath = await resolveGitProjectPath(
            command.input.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          return withGitWriteGate(context.workspaceWriteGate, projectPath.path, requestId, command.type, async () => {
            const result = await git.checkout({ ...command.input, projectPath: projectPath.path });
            return ok(requestId, 'git/checkout', { result });
          });
        }
        case 'git/stash': {
          const projectPath = await resolveGitProjectPath(
            command.input.projectPath,
            context.piwinRoot,
            requestId,
            command.type,
          );
          if (!projectPath.ok) return projectPath.response;
          return withGitWriteGate(context.workspaceWriteGate, projectPath.path, requestId, command.type, async () => {
            const result = await git.stash({ ...command.input, projectPath: projectPath.path });
            return ok(requestId, 'git/stash', { result });
          });
        }
    default:
      return null;
  }
}

async function withGitWriteGate(
  gate: WorkspaceWriteGate | undefined,
  projectPath: string,
  requestId: string | undefined,
  commandType: HostCommand['type'],
  run: () => Promise<HostResponse>,
): Promise<HostResponse> {
  const execute = async (): Promise<HostResponse> => {
    try {
      return await run();
    } catch (error) {
      return fail(requestId, commandType, formatError(error));
    }
  };
  if (!gate) {
    return execute();
  }
  const acquired = await gate.tryAcquire({
    workspaceId: projectPath,
    rootPath: projectPath,
    kind: 'git',
    mode: 'exclusive',
    wait: true,
  });
  if (!acquired.ok) {
    return fail(requestId, commandType, acquired.reason);
  }
  try {
    return await execute();
  } finally {
    acquired.lease.release();
  }
}

async function resolveGitProjectPath(
  locator: string,
  piwinRoot: string | undefined,
  requestId: string | undefined,
  commandType: HostCommand['type'],
): Promise<{ ok: true; path: string } | { ok: false; response: HostResponse }> {
  const bound = await bindProjectLocatorFromRoot(locator, piwinRoot);
  if (!bound.ok) {
    return { ok: false, response: fail(requestId, commandType, bound.error) };
  }
  return bound;
}
