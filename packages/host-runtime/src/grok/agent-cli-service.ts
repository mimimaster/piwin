/**
 * Host composition of native agent terminals (Desktop ↔ CLI writer handoff).
 *
 * Generic launch uses session/cli-launch + Host-verified binary/cwd. Grok's
 * legacy buildGrokCliLaunch remains only for old Grok adapters without the
 * new method. Ownership is Host-managed per product session; remote disconnect
 * never releases the writer.
 */
import type {
  AgentCliOpenData,
  AgentCliFailureCode,
  AgentCliOpenInput,
  AgentCliOwnership,
  AgentCliStatusData,
  AgentCliSyncData,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';
import {
  formatError,
  isAgentCliOpenInput,
  isExternalAgentNativeCliReady,
  isNativeCliSupported,
  isValidTerminalSize,
} from '@piwin/contracts';
import { listProjects } from '@piwin/project';
import {
  InteractiveTerminalManager,
  resolveTrustedCwd,
} from '@piwin/process';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { ensureGeneralWorkspace, isGeneralWorkspacePath } from '../general-workspace.js';
import { getPiwinProjectsPath, getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { bindProjectLocatorFromRoot } from '../project-locator.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { fail, ok } from '../response-helpers.js';
import {
  AgentCliOwnershipController,
  ownershipPush,
} from '../native-cli-ownership.js';
import { AgentCliError } from './native-cli-error.js';
import { NativeCliCatalogObserver } from './native-cli-catalog.js';
import { NativeCliOutputBuffer } from './native-cli-output.js';
import { snapshotNativeCliHistory } from './native-cli-history.js';
import { markExternalConversationActivity } from './grok-catalog-sync.js';
import { resolveNativeCliLaunch } from './native-cli-launch.js';

type SessionPty = { ptyId: string; agentId: string };

/** Host composition of native vendor terminals, including remote Desktop clients. */
export class AgentCliService {
  private readonly terminals: InteractiveTerminalManager;
  private readonly syncing = new Map<string, Promise<void>>();
  private readonly sessionPtys = new Map<string, SessionPty>();
  private readonly ownership: AgentCliOwnershipController;
  private readonly catalog: NativeCliCatalogObserver;
  private readonly output = new Map<string, NativeCliOutputBuffer>();

  public constructor(private readonly deps: HostRuntimeKernel) {
    this.ownership = deps.agentCliOwnership ?? new AgentCliOwnershipController({
      onChange: (state) => deps.push(ownershipPush(state)),
    });
    deps.agentCliOwnership = this.ownership;
    this.catalog = new NativeCliCatalogObserver(deps, this.ownership);
    this.terminals = new InteractiveTerminalManager({
      onData: (ptyId, data) => {
        let buffer = this.output.get(ptyId);
        if (buffer === undefined) { buffer = new NativeCliOutputBuffer(); this.output.set(ptyId, buffer); }
        buffer.append(data);
        deps.push({ type: 'pty/output', ptyId, data, at: new Date().toISOString(), sequence: buffer.getSequence() });
      },
      onExit: (ptyId, exitCode) => {
        deps.push({ type: 'pty/exit', ptyId, exitCode });
        this.handlePtyExit(ptyId);
      },
    });
  }

  public getOwnership(sessionId: string): AgentCliOwnership {
    return this.ownership.get(sessionId);
  }

  /** Synchronous Desktop writer gate used by prompt admission and queue drain. */
  public isDesktopWriterBlocked(sessionId: string): boolean {
    return this.ownership.isDesktopWriterBlocked(sessionId);
  }

  /** A Desktop send may take an idle native writer; active turns stay on their actor. */
  public async handoffIfIdle(sessionId: string): Promise<boolean> {
    const owner = this.ownership.get(sessionId);
    if (owner.kind === 'desktop') return true;
    if (owner.kind !== 'native') return false;
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    if (record?.backend?.backendSessionId === undefined) return false;
    const observed = await this.deps.externalAgents?.observeNativeSession(record.backend.agentId, {
      backendSessionId: record.backend.backendSessionId, workingDirectory: workingDirectoryFromIndexRecord(record, root),
    });
    if (observed?.activity !== 'idle' || this.ownership.get(sessionId).kind !== 'native') return false;
    await this.sync(sessionId, false);
    return this.ownership.get(sessionId).kind === 'desktop';
  }

  public async handle(command: HostCommand, requestId: string | undefined): Promise<HostResponse | null> {
    try {
      switch (command.type) {
        case 'agents/cli-open': return ok(requestId, command.type, await this.open(command.input));
        case 'agents/cli-sync': return ok(requestId, command.type, await this.sync(command.sessionId, command.preserveNative === true));
        case 'agents/cli-snapshot': return ok(requestId, command.type, await this.sync(command.sessionId, true));
        case 'agents/cli-status': return ok(requestId, command.type, this.status(command.sessionId));
        case 'pty/write':
          this.terminals.write(command.ptyId, command.data);
          this.noteNativeSubmit(command.ptyId, command.data);
          return ok(requestId, command.type, {});
        case 'pty/resize':
          this.terminals.resize(command.ptyId, command.cols, command.rows);
          return ok(requestId, command.type, {});
        case 'pty/close':
          await this.closePty(command.ptyId);
          return ok(requestId, command.type, {});
        default: return null;
      }
    } catch (error) {
      return fail(requestId, command.type, formatError(error));
    }
  }

  public async dispose(): Promise<void> {
    await this.catalog.dispose();
    await Promise.allSettled(this.syncing.values());
    await this.terminals.dispose();
  }

  private status(sessionId: string): AgentCliStatusData {
    return { ownership: this.ownership.get(sessionId) };
  }

  private async open(input: AgentCliOpenInput): Promise<AgentCliOpenData> {
    if (!isAgentCliOpenInput(input) || !isValidTerminalSize(input.cols, input.rows)) {
      throw cliError('cli-unsupported', 'unsupported-agent-cli');
    }
    const backend = this.deps.externalAgents;
    if (backend === undefined) throw cliError('not-ready', 'external-agent-backend-unavailable');

    const root = getPiwinRoot(this.deps.options.piwinRoot);
    let sessionId = input.sessionId;
    let reserved = false;

    try {
      if (sessionId === undefined) {
        const bound = input.projectPath === undefined
          ? { ok: true as const, path: await ensureGeneralWorkspace(root) }
          : await bindProjectLocatorFromRoot(input.projectPath, root);
        if (!bound.ok) throw cliError('session-unavailable', bound.error);
        await this.requireTrustedProject(bound.path);
        const created = await this.deps.handleCommand({
          type: 'session/create', input: { agentId: input.agentId, projectPath: bound.path },
        });
        if (!created.success) throw cliError('session-unavailable', created.error);
        const data = created.data as { sessionId?: string };
        if (typeof data.sessionId !== 'string') throw cliError('session-unavailable', 'agent-cli-session-create-failed');
        sessionId = data.sessionId;
      }

      // Once the product session id is known, reserve synchronously before further awaits.
      const existing = this.sessionPtys.get(sessionId);
      if (existing !== undefined) {
        if (existing.agentId !== input.agentId) throw cliError('session-unavailable', 'agent-cli-session-unavailable');
        const ownership = this.ownership.get(sessionId);
        const buffer = this.output.get(existing.ptyId);
        const initialOutput = buffer?.read().join('');
        return { ptyId: existing.ptyId, sessionId, ownership, ...(buffer !== undefined && initialOutput ? { initialOutput, initialOutputThrough: buffer.getSequence() } : {}) };
      }

      const busy = this.ownership.tryBeginNative(
        sessionId,
        this.deps.runRegistry.getForegroundRun(sessionId) !== undefined,
      );
      if (busy !== undefined) throw cliError(busy, busy);
      reserved = true;

      await this.assertLaunchReady(input.agentId, sessionId);

      let record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
      if (record?.backend?.agentId !== input.agentId || record.isArchived) {
        throw cliError('session-unavailable', 'agent-cli-session-unavailable');
      }
      const cwd = workingDirectoryFromIndexRecord(record, root);
      await this.requireTrustedProject(cwd);

      if (record.backend.backendSessionId === undefined) {
        await this.deps.activateSessionRuntime(sessionId);
        record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
      }
      if (record?.backend === undefined || record.backend.backendSessionId === undefined) {
        throw cliError('session-unavailable', 'agent-cli-session-unavailable');
      }
      const nativeId = record.backend.backendSessionId;
      const executable = await backend.requireReadyBinary(input.agentId);

      // Recheck after awaits (TOCTOU): enabled/revision/readiness may have changed.
      await this.assertLaunchReady(input.agentId, sessionId);
      if (this.deps.runRegistry.getForegroundRun(sessionId) !== undefined) {
        throw cliError('writer-busy', 'writer-busy');
      }

      const launch = await resolveNativeCliLaunch(this.deps, {
        agentId: input.agentId,
        sessionId,
        nativeId,
        executable,
        cwd,
        cols: input.cols,
        rows: input.rows,
        binding: record.backend,
      });

      // Structured ACP observer must be idle/disposed before the interactive PTY.
      await this.suspendStructuredRuntime(sessionId);

      const ptyId = await this.terminals.open(launch);
      this.sessionPtys.set(sessionId, { ptyId, agentId: input.agentId });
      this.ownership.confirmNative(sessionId, ptyId);
      this.catalog.start(record);
      reserved = false;
      return { ptyId, sessionId, ownership: this.ownership.get(sessionId) };
    } catch (error) {
      if (reserved && sessionId !== undefined) {
        this.ownership.abortNativeOpen(sessionId);
      }
      throw error;
    }
  }

  private async assertLaunchReady(agentId: string, sessionId: string): Promise<void> {
    const backend = this.deps.externalAgents;
    if (backend === undefined) throw cliError('not-ready', 'external-agent-backend-unavailable');
    // Revalidate installation without spawning another readiness probe per gate.
    const status = await backend.getStatus(agentId);
    // Grok legacy adapters may omit nativeCli; other backends must advertise it while ready.
    if (agentId !== 'grok' && !isExternalAgentNativeCliReady(status)) {
      throw cliError('not-ready', 'native-cli-not-ready');
    }
    if (status.state !== 'ready' && status.state !== 'unauthenticated') {
      throw cliError('not-ready', `agent-not-ready:${status.state}`);
    }
    if (status.state !== 'ready') {
      throw cliError('not-ready', 'agent-not-ready');
    }
    const caps = backend.getSessionCapabilities(sessionId);
    if (caps !== undefined && agentId !== 'grok' && !isNativeCliSupported(caps)) {
      throw cliError('cli-unsupported', 'native-cli-unsupported');
    }
  }

  private async suspendStructuredRuntime(sessionId: string): Promise<void> {
    const generation = this.deps.runtimeController.getStatus(sessionId).generationId;
    if (generation === undefined) return;
    const suspended = await this.deps.residencyController.requestSuspend(sessionId, generation, 'manual');
    if (!suspended) {
      throw cliError('transition-failed', 'structured-runtime-busy');
    }
  }

  private async sync(sessionId: string, preserveNative: boolean): Promise<AgentCliSyncData> {
    const pending = this.syncing.get(sessionId);
    if (pending !== undefined) {
      await pending;
      return { sessionId, ownership: this.ownership.get(sessionId) };
    }
    const operation = preserveNative
      ? this.snapshotOrLegacyRefresh(sessionId).then(() => {
          const owner = this.ownership.get(sessionId);
          if (!this.sessionPtys.has(sessionId) && owner.kind === 'switching' && owner.target === 'desktop') {
            this.ownership.confirmDesktop(sessionId);
            this.deps.queuedTurnController?.requestDrain(sessionId);
          }
        }) : this.returnToDesktop(sessionId);
    this.syncing.set(sessionId, operation);
    try {
      await operation;
      return { sessionId, ownership: this.ownership.get(sessionId) };
    } finally {
      this.syncing.delete(sessionId);
    }
  }

  /**
   * Older agent extensions cannot export native history. Fall back to the
   * pre-snapshot incremental refresh instead of surfacing `cli-unsupported`.
   */
  private async snapshotOrLegacyRefresh(sessionId: string): Promise<void> {
    try {
      await snapshotNativeCliHistory(this.deps, sessionId);
    } catch (error) {
      if (!(error instanceof AgentCliError) || error.code !== 'cli-unsupported') throw error;
      // The native CLI still owns the writer; reloading now would race it.
      // The exit-time return path imports the history once it closes.
      if (this.sessionPtys.has(sessionId)) return;
      const record = await getSessionRecord(
        getPiwinSessionIndexPath(getPiwinRoot(this.deps.options.piwinRoot)),
        sessionId,
      );
      const agentId = record?.backend?.agentId;
      const nativeId = record?.backend?.backendSessionId;
      if (agentId === undefined || nativeId === undefined) {
        throw cliError('session-unavailable', 'agent-cli-session-unavailable');
      }
      await this.refreshHistory(sessionId, agentId, nativeId);
    }
  }

  /**
   * Close owned native PTY → await real exit → retire structured observer →
   * import history on the exact native id → unlock Desktop → requestDrain.
   * Failed load retains switching; never reopens a "latest" native id.
   */
  private async returnToDesktop(sessionId: string): Promise<void> {
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    if (record?.backend?.agentId === undefined) {
      throw cliError('session-unavailable', 'agent-cli-session-unavailable');
    }
    const nativeId = record.backend.backendSessionId;
    if (nativeId === undefined) {
      throw cliError('session-unavailable', 'agent-cli-native-id-missing');
    }

    const attached = this.sessionPtys.get(sessionId);
    if (attached !== undefined) {
      const begin = this.ownership.tryBeginDesktop(sessionId);
      if (begin !== undefined) throw cliError(begin, begin);
      try {
        await this.terminals.close(attached.ptyId);
      } catch (error) {
        this.ownership.markRecovery(sessionId, attached.ptyId);
        throw error;
      }
      this.sessionPtys.delete(sessionId);
      this.catalog.stop(sessionId);
    } else if (this.ownership.get(sessionId).kind === 'native') {
      this.ownership.markRecovery(sessionId);
    } else if (this.ownership.get(sessionId).kind === 'desktop') {
      // History-only refresh path (no attached PTY) for catalog-imported sessions.
      await this.refreshHistory(sessionId, record.backend.agentId, nativeId);
      return;
    }

    try {
      await this.refreshHistory(sessionId, record.backend.agentId, nativeId);
      this.ownership.confirmDesktop(sessionId);
      this.deps.queuedTurnController?.requestDrain(sessionId);
    } catch (error) {
      this.ownership.markRecovery(sessionId, attached?.ptyId);
      throw error;
    }
  }

  private async refreshHistory(sessionId: string, agentId: string, expectedNativeId: string): Promise<void> {
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    // A Host-controlled turn keeps its observer and Run.
    if (this.deps.runRegistry.getForegroundRun(sessionId) !== undefined) return;
    const latest = await getSessionRecord(getPiwinSessionIndexPath(root), sessionId);
    if (latest?.backend?.agentId !== agentId) {
      throw cliError('session-unavailable', 'agent-cli-session-unavailable');
    }
    if (latest.backend.backendSessionId !== expectedNativeId) {
      throw cliError('transition-failed', 'agent-cli-native-id-changed');
    }
    delete latest.backend.syncedChangeUnixMs;
    await upsertSessionRecord(getPiwinSessionIndexPath(root), latest);
    const generation = this.deps.runtimeController.getStatus(sessionId).generationId;
    if (generation !== undefined) {
      const suspended = await this.deps.residencyController.requestSuspend(sessionId, generation, 'manual');
      if (!suspended) {
        throw cliError('transition-failed', 'structured-runtime-busy');
      }
    }
    await this.deps.activateSessionRuntime(sessionId);
  }

  /**
   * Opening or resuming a native session moves the agent's own last-change
   * time, so the Host's evidence of a native turn is the person submitting
   * input in that session's terminal.
   */
  private noteNativeSubmit(ptyId: string, data: string): void {
    if (!data.includes('\r') && !data.includes('\n')) return;
    for (const [sessionId, entry] of this.sessionPtys) {
      if (entry.ptyId !== ptyId) continue;
      void markExternalConversationActivity(this.deps, sessionId, Date.now()).catch((error: unknown) => {
        this.deps.push({ type: 'host/log', level: 'warn', message: `native session activity update failed: ${formatError(error)}` });
      });
      return;
    }
  }

  private handlePtyExit(ptyId: string): void {
    this.output.delete(ptyId);
    for (const [sessionId, entry] of this.sessionPtys) {
      if (entry.ptyId !== ptyId) continue;
      this.sessionPtys.delete(sessionId);
      this.catalog.stop(sessionId);
      const current = this.ownership.get(sessionId);
      if (current.kind === 'native' || (current.kind === 'switching' && current.target === 'native')) {
        // Unexpected exit: keep switching until an explicit successful sync.
        this.ownership.markRecovery(sessionId, ptyId);
      }
      return;
    }
  }

  private async closePty(ptyId: string): Promise<void> {
    // Client pty/close hides the terminal only. Write ownership is retained
    // across disconnect/reconnect until agents/cli-sync completes.
    if ([...this.sessionPtys.values()].some((entry) => entry.ptyId === ptyId)) return;
    await this.terminals.close(ptyId);
  }

  private async requireTrustedProject(cwd: string): Promise<void> {
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    if (isGeneralWorkspacePath(cwd, root)) return;
    const projects = await listProjects(getPiwinProjectsPath(root));
    if (!resolveTrustedCwd(cwd, projects.filter((project) => project.trust === 'trusted').map((project) => project.path)).ok) {
      throw cliError('session-unavailable', 'project-not-trusted: trust the workspace before opening its CLI');
    }
  }
}

function cliError(code: AgentCliFailureCode, message: string): Error {
  return new AgentCliError(code, message);
}

export async function handleAgentCliCommand(
  deps: HostRuntimeKernel, command: HostCommand, requestId: string | undefined,
): Promise<HostResponse | null> {
  if (!['agents/cli-open', 'agents/cli-sync', 'agents/cli-snapshot', 'agents/cli-status', 'pty/write', 'pty/resize', 'pty/close'].includes(command.type)) {
    return null;
  }
  deps.agentCliService ??= new AgentCliService(deps);
  return deps.agentCliService.handle(command, requestId);
}
