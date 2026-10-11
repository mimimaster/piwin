import type { AgentCliOpenData, AgentCliOpenInput, HostCommand, HostResponse } from '@piwin/contracts';
import { formatError, isValidTerminalSize } from '@piwin/contracts';
import { listProjects } from '@piwin/project';
import { InteractiveTerminalManager, resolveTrustedCwd } from '@piwin/process';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { ensureGeneralWorkspace, isGeneralWorkspacePath } from '../general-workspace.js';
import { getPiwinProjectsPath, getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { bindProjectLocatorFromRoot } from '../project-locator.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { fail, ok } from '../response-helpers.js';
import { buildGrokCliLaunch } from './grok-cli-launch.js';

/** Host composition of native vendor terminals, including remote Desktop clients. */
export class AgentCliService {
  private readonly terminals: InteractiveTerminalManager;
  private readonly syncing = new Map<string, Promise<void>>();

  public constructor(private readonly deps: HostRuntimeKernel) {
    this.terminals = new InteractiveTerminalManager({
      onData: (ptyId, data) => deps.push({ type: 'pty/output', ptyId, data, at: new Date().toISOString() }),
      onExit: (ptyId, exitCode) => {
        deps.push({ type: 'pty/exit', ptyId, exitCode });
      },
    });
  }

  public async handle(command: HostCommand, requestId: string | undefined): Promise<HostResponse | null> {
    try {
      switch (command.type) {
        case 'agents/cli-open': return ok(requestId, command.type, await this.open(command.input));
        case 'agents/cli-sync':
          await this.sync(command.sessionId);
          return ok(requestId, command.type, { sessionId: command.sessionId });
        case 'pty/write':
          this.terminals.write(command.ptyId, command.data);
          return ok(requestId, command.type, {});
        case 'pty/resize':
          this.terminals.resize(command.ptyId, command.cols, command.rows);
          return ok(requestId, command.type, {});
        case 'pty/close':
          await this.terminals.close(command.ptyId);
          return ok(requestId, command.type, {});
        default: return null;
      }
    } catch (error) {
      return fail(requestId, command.type, formatError(error));
    }
  }

  public async dispose(): Promise<void> {
    await Promise.allSettled(this.syncing.values());
    await this.terminals.dispose();
  }

  private async open(input: AgentCliOpenInput): Promise<AgentCliOpenData> {
    if (input.agentId !== 'grok' || !isValidTerminalSize(input.cols, input.rows)) {
      throw new Error('unsupported-agent-cli');
    }
    const backend = this.deps.externalAgents;
    if (backend === undefined) throw new Error('external-agent-backend-unavailable');
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    const executable = await backend.requireReadyBinary(input.agentId);
    let sessionId = input.sessionId;
    if (sessionId === undefined) {
      const bound = input.projectPath === undefined
        ? { ok: true as const, path: await ensureGeneralWorkspace(root) }
        : await bindProjectLocatorFromRoot(input.projectPath, root);
      if (!bound.ok) throw new Error(bound.error);
      await this.requireTrustedProject(bound.path);
      const created = await this.deps.handleCommand({
        type: 'session/create', input: { agentId: input.agentId, projectPath: bound.path },
      });
      if (!created.success) throw new Error(created.error);
      const data = created.data as { sessionId?: string };
      if (typeof data.sessionId !== 'string') throw new Error('agent-cli-session-create-failed');
      sessionId = data.sessionId;
    }
    let record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    if (record?.backend?.agentId !== input.agentId || record.isArchived) throw new Error('agent-cli-session-unavailable');
    const cwd = workingDirectoryFromIndexRecord(record, root);
    await this.requireTrustedProject(cwd);
    // First activation creates/binds a native id; an already-running session is kept.
    if (record.backend.backendSessionId === undefined) {
      await this.deps.activateSessionRuntime(sessionId);
      record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    }
    if (record?.backend === undefined) throw new Error('agent-cli-session-unavailable');
    const ptyId = await this.terminals.open(buildGrokCliLaunch({
      binding: record.backend, executable, cwd, cols: input.cols, rows: input.rows,
    }));
    return { ptyId, sessionId };
  }

  private async sync(sessionId: string): Promise<void> {
    const pending = this.syncing.get(sessionId);
    if (pending !== undefined) return pending;
    const operation = this.refreshHistory(sessionId);
    this.syncing.set(sessionId, operation);
    try { await operation; } finally { this.syncing.delete(sessionId); }
  }

  private async refreshHistory(sessionId: string): Promise<void> {
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    if (record?.backend?.agentId !== 'grok') throw new Error('agent-cli-session-unavailable');
    // A Host-controlled turn keeps its observer and Run. Otherwise reopen via
    // session/load so native TUI turns replace the stale transcript projection.
    if (this.deps.runRegistry.getForegroundRun(sessionId) !== undefined) return;
    const latest = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    if (latest?.backend?.agentId !== 'grok') throw new Error('agent-cli-session-unavailable');
    delete latest.backend.syncedChangeUnixMs;
    await upsertSessionRecord(getPiwinSessionIndexPath(root), latest);
    const generation = this.deps.runtimeController.getStatus(sessionId).generationId;
    // Suspension rechecks protected work and lets arriving prompts await the
    // transition; disposal would cancel a Run admitted during the index read.
    if (generation !== undefined && !await this.deps.residencyController.requestSuspend(sessionId, generation, 'manual')) return;
    await this.deps.activateSessionRuntime(sessionId);
  }

  private async requireTrustedProject(cwd: string): Promise<void> {
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    if (isGeneralWorkspacePath(cwd, root)) return;
    const projects = await listProjects(getPiwinProjectsPath(root));
    if (!resolveTrustedCwd(cwd, projects.filter((project) => project.trust === 'trusted').map((project) => project.path)).ok) {
      throw new Error('project-not-trusted: trust the workspace before opening its CLI');
    }
  }
}

export async function handleAgentCliCommand(
  deps: HostRuntimeKernel, command: HostCommand, requestId: string | undefined,
): Promise<HostResponse | null> {
  if (!['agents/cli-open', 'agents/cli-sync', 'pty/write', 'pty/resize', 'pty/close'].includes(command.type)) return null;
  deps.agentCliService ??= new AgentCliService(deps);
  return deps.agentCliService.handle(command, requestId);
}
