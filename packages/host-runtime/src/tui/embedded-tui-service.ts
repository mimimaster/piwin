/**
 * The terminal shell run on the Host's own machine (ADR 0102).
 *
 * Shells that cannot open a terminal (the phone, a browser) ask for
 * `piwin tui --embedded` here. It is another client of this same Host: it
 * connects back through the loopback entrance, and its bytes reach the
 * asking shell as `pty/output` through the Host terminal registry.
 *
 * The client names only a session or a project and a grid. Program,
 * arguments, environment and working directory are decided here.
 */
import type { EmbeddedTuiOpenData, EmbeddedTuiOpenInput, HostCommand, HostResponse } from '@piwin/contracts';
import { formatError, isEmbeddedTuiOpenInput } from '@piwin/contracts';
import { listProjects } from '@piwin/project';
import { resolveTrustedCwd } from '@piwin/process';
import { getSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { ensureGeneralWorkspace } from '../general-workspace.js';
import { getPiwinProjectsPath, getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { bindProjectLocatorFromRoot } from '../project-locator.js';
import { fail, ok } from '../response-helpers.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { listTrustedProjectRoots } from '../trusted-project-roots.js';
import { hostTerminals, type HostTerminalOwner } from '../terminal/host-terminal-registry.js';
import { TuiSessionScanner } from './tui-session-scanner.js';

/** How the Host reaches itself and starts its own CLI; only `host serve` provides both. */
export type EmbeddedTuiPorts = {
  /** Loopback WebSocket entrance and the token that admits a process on this machine. */
  openLoopbackEntrance: () => Promise<{ endpoint: string; authToken: string }>;
  /** The piwin CLI on this machine, without a subcommand. */
  invocation: { program: string; args: readonly string[] };
};

/** Phones vanish without closing; the oldest idle terminal makes room. */
export const MAX_EMBEDDED_TUIS = 4;
/** pi-tui redraws the whole screen when the width changes; give it two widths. */
const REDRAW_NUDGE_MS = 80;

type TuiTerminal = {
  ptyId: string;
  sessionId: string | null;
  lastActiveAt: number;
};

export class EmbeddedTuiError extends Error {
  public override readonly name = 'EmbeddedTuiError';
}

export class EmbeddedTuiService {
  private readonly terminals = new Map<string, TuiTerminal>();
  private clock = 0;

  public constructor(
    private readonly deps: HostRuntimeKernel,
    private readonly ports: EmbeddedTuiPorts,
  ) {}

  public async open(input: EmbeddedTuiOpenInput): Promise<EmbeddedTuiOpenData> {
    if (!isEmbeddedTuiOpenInput(input)) throw new EmbeddedTuiError('invalid-tui-open');
    const running = input.sessionId === undefined
      ? undefined
      : [...this.terminals.values()].find((terminal) => terminal.sessionId === input.sessionId);
    if (running !== undefined) {
      this.reattach(running, input.cols, input.rows);
      return { ptyId: running.ptyId, reattached: true };
    }
    const launch = await this.resolveLaunch(input);
    await this.makeRoom();
    const entrance = await this.ports.openLoopbackEntrance();
    const scanner = new TuiSessionScanner();
    let terminal: TuiTerminal | undefined;
    const owner: HostTerminalOwner = {
      onData: (_ptyId, data) => {
        const sessionId = scanner.scan(data);
        if (sessionId !== undefined && terminal !== undefined) terminal.sessionId = sessionId;
      },
      onWrite: () => {
        if (terminal !== undefined) terminal.lastActiveAt = this.tick();
      },
      onExit: (ptyId) => {
        this.terminals.delete(ptyId);
      },
    };
    const ptyId = await hostTerminals(this.deps).open({
      executable: this.ports.invocation.program,
      args: [...this.ports.invocation.args, ...launch.args],
      cwd: launch.cwd,
      cols: input.cols,
      rows: input.rows,
      environment: embeddedTuiEnvironment(entrance, process.env.PIWIN_IMAGES),
    }, owner);
    terminal = { ptyId, sessionId: input.sessionId ?? null, lastActiveAt: this.tick() };
    this.terminals.set(ptyId, terminal);
    return { ptyId };
  }

  public async handle(command: HostCommand, requestId: string | undefined): Promise<HostResponse | null> {
    if (command.type !== 'tui/open') return null;
    try {
      return ok(requestId, command.type, await this.open(command.input));
    } catch (error) {
      return fail(requestId, command.type, formatError(error));
    }
  }

  private reattach(terminal: TuiTerminal, cols: number, rows: number): void {
    terminal.lastActiveAt = this.tick();
    const registry = hostTerminals(this.deps);
    // No byte replay: a fresh view gets a full redraw instead of stale frames.
    registry.resize(terminal.ptyId, Math.max(2, cols - 1), rows);
    const timer = setTimeout(() => {
      if (!this.terminals.has(terminal.ptyId)) return;
      try {
        registry.resize(terminal.ptyId, cols, rows);
      } catch (error) {
        this.deps.push({ type: 'host/log', level: 'warn', message: `tui redraw failed: ${formatError(error)}` });
      }
    }, REDRAW_NUDGE_MS);
    timer.unref?.();
  }

  private async makeRoom(): Promise<void> {
    if (this.terminals.size < MAX_EMBEDDED_TUIS) return;
    const oldest = [...this.terminals.values()].sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
    if (oldest === undefined) return;
    this.terminals.delete(oldest.ptyId);
    await hostTerminals(this.deps).close(oldest.ptyId);
  }

  private async resolveLaunch(input: EmbeddedTuiOpenInput): Promise<{ args: string[]; cwd: string }> {
    const root = getPiwinRoot(this.deps.options.piwinRoot);
    const trusted = await listTrustedProjectRoots(this.deps.options.piwinRoot);
    const generalCwd = await ensureGeneralWorkspace(root);
    // The TUI completes file names against its cwd: a trusted project, else the general workspace.
    const cwdFor = (path: string): string => resolveTrustedCwd(path, trusted).ok ? path : generalCwd;
    if (input.sessionId !== undefined) {
      const record = await getSessionRecord(getPiwinSessionIndexPath(root), input.sessionId);
      if (record === undefined) throw new EmbeddedTuiError('session-unavailable');
      return {
        args: embeddedTuiArguments({ sessionId: input.sessionId }),
        cwd: cwdFor(workingDirectoryFromIndexRecord(record, root)),
      };
    }
    if (input.projectPath !== undefined) {
      const bound = await bindProjectLocatorFromRoot(input.projectPath, root);
      if (!bound.ok) throw new EmbeddedTuiError(bound.error);
      // A local caller may pass a path; it still has to be a project this Host has.
      const known = await listProjects(getPiwinProjectsPath(root));
      if (bound.path !== generalCwd && !known.some((project) => project.path === bound.path)) {
        throw new EmbeddedTuiError('unknown-project');
      }
      if (bound.path === generalCwd) return { args: embeddedTuiArguments({}), cwd: generalCwd };
      return { args: embeddedTuiArguments({ projectPath: bound.path }), cwd: cwdFor(bound.path) };
    }
    return { args: embeddedTuiArguments({}), cwd: generalCwd };
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }
}

/** Same subcommand the Desktop launcher builds (`pty_tui.rs`). */
export function embeddedTuiArguments(scope: { sessionId?: string; projectPath?: string }): string[] {
  const args = ['tui', '--embedded'];
  if (scope.sessionId !== undefined) return [...args, '--session', scope.sessionId];
  if (scope.projectPath !== undefined) return [...args, '--project-path', scope.projectPath];
  return args;
}

/**
 * Admission to this Host only. Inherited selections of other Hosts are
 * cleared, and so is the external editor: vi on the Host would be a shell for
 * whoever holds the phone.
 */
export function embeddedTuiEnvironment(
  entrance: { endpoint: string; authToken: string },
  inheritedImages: string | undefined,
): Record<string, string | null> {
  return {
    PIWIN_HOST_URL: entrance.endpoint,
    PIWIN_HOST_TOKEN: entrance.authToken,
    PIWIN_HOST: null,
    PIWIN_HOST_DEVICE_ID: null,
    PIWIN_HOST_DEVICE_SECRET: null,
    VISUAL: '',
    EDITOR: '',
    // The phone's xterm loads the iTerm2 image addon, like Desktop's.
    PIWIN_IMAGES: inheritedImages !== undefined && inheritedImages.length > 0 ? inheritedImages : 'iterm2',
  };
}

export async function handleEmbeddedTuiCommand(
  deps: HostRuntimeKernel,
  command: HostCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  if (command.type !== 'tui/open') return null;
  const ports = deps.options.embeddedTui;
  if (ports === undefined) return fail(requestId, command.type, 'embedded-tui-unavailable');
  deps.embeddedTuiService ??= new EmbeddedTuiService(deps, ports);
  return deps.embeddedTuiService.handle(command, requestId);
}
