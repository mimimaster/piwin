/**
 * Host circuit breaker for a Pi tool loop that never starts real work.
 *
 * Why (2026-09-12, packaged piwinwin session-mty49b6o-eukp1lwv): Pi
 * auto-continues after every tool result until the model stops calling tools.
 * Built-in `read` / `grep` / `ls` run inside Pi, so Host tool admission never
 * sees them. The model treated "confirm again" as the next step — 46 assistant
 * turns, 112 reads, 42 greps, one early bash, zero writes — and the Run stayed
 * live for almost two hours.
 *
 * This detector watches AgentEvents (the only surface that includes Pi
 * builtins) and asks Host to fail the Run once inspect-only work repeats
 * without a mutating tool.
 */

export const DEFAULT_MAX_INSPECT_ONLY_TURNS = 12;
export const DEFAULT_MAX_INSPECT_STALL_ROUNDS = 10;
export const DEFAULT_MAX_TOOL_LOOP_TURNS = 32;

export type ToolLoopClass = 'inspect' | 'progress' | 'neutral';

export type ToolLoopLimits = {
  /** Consecutive inspect-only tool-loop turns. `0` disables this bound. */
  maxInspectOnlyTurns: number;
  /**
   * Consecutive inspect-only turns that added no new path/pattern fingerprint.
   * `0` disables this bound.
   */
  maxInspectStallRounds: number;
  /** Total assistant turns that called at least one tool. `0` disables. */
  maxToolLoopTurns: number;
};

export type ToolLoopDecision =
  | { action: 'continue' }
  | {
      action: 'stop';
      reason: 'inspect-only' | 'inspect-stall' | 'max-turns';
      message: string;
      inspectOnlyTurns: number;
      stallRounds: number;
      toolLoopTurns: number;
    };

export type ToolLoopObservation = {
  toolName: string;
  targetPaths?: readonly string[];
  inputPreview?: string;
  command?: string;
};

const DEFAULT_LIMITS: ToolLoopLimits = {
  maxInspectOnlyTurns: DEFAULT_MAX_INSPECT_ONLY_TURNS,
  maxInspectStallRounds: DEFAULT_MAX_INSPECT_STALL_ROUNDS,
  maxToolLoopTurns: DEFAULT_MAX_TOOL_LOOP_TURNS,
};

const INSPECT_NAMES = new Set([
  'read',
  'read_file',
  'view',
  'view_file',
  'open_file',
  'grep',
  'rg',
  'grep_search',
  'codebase_search',
  'semantic_search',
  'find_content',
  'search_code',
  'glob',
  'glob_file_search',
  'find',
  'find_files',
  'list_dir',
  'list_directory',
  'list_files',
  'ls',
  'tree',
  'web_search',
  'web-search',
  'web_fetch',
  'web-fetch',
  'fetch_url',
  'knowledge_search',
  'knowledge_read',
  'knowledge_list',
  'note_search',
  'note_read',
  'note_list',
]);

const PROGRESS_NAMES = new Set([
  'write',
  'edit',
  'apply_patch',
  'write_file',
  'str_replace',
  'search_replace',
  'apply_diff',
  'multi_edit',
  'delete_file',
  'bash',
  'shell',
  'run_bash',
  'run_terminal_cmd',
  'execute_command',
  'run_command',
  'piwin_subagent_run',
  'piwin_subagent_start',
  'piwin_subagent_continue',
  'piwin_subagent_result_apply',
]);

type OpenTurn = {
  inspect: boolean;
  progress: boolean;
  newFingerprint: boolean;
};

type RunLoopState = {
  inspectOnlyTurns: number;
  stallRounds: number;
  toolLoopTurns: number;
  seenFingerprints: Set<string>;
  open: OpenTurn | undefined;
  stopped: boolean;
};

export function createDefaultToolLoopLimits(): ToolLoopLimits {
  return { ...DEFAULT_LIMITS };
}

export function classifyToolLoopClass(toolName: string): ToolLoopClass {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return 'neutral';
  }
  if (PROGRESS_NAMES.has(normalized) || isProgressAlias(normalized)) {
    return 'progress';
  }
  if (INSPECT_NAMES.has(normalized) || isInspectAlias(normalized)) {
    return 'inspect';
  }
  return 'neutral';
}

export function fingerprintToolLoopCall(observation: ToolLoopObservation): string {
  const toolName = observation.toolName.trim().toLowerCase() || 'unknown';
  const paths = observation.targetPaths?.filter((path) => path.trim().length > 0) ?? [];
  if (paths.length > 0) {
    return `${toolName}:${paths.join('\0')}`;
  }
  const preview = observation.inputPreview?.trim();
  if (preview) {
    return `${toolName}:${preview}`;
  }
  const command = observation.command?.trim();
  if (command) {
    return `${toolName}:${command}`;
  }
  return toolName;
}

export function formatToolLoopStopMessage(input: {
  reason: 'inspect-only' | 'inspect-stall' | 'max-turns';
  inspectOnlyTurns: number;
  stallRounds: number;
  toolLoopTurns: number;
}): string {
  const counts = `${input.inspectOnlyTurns} inspect-only turns, ${input.stallRounds} repeated-search turns, ${input.toolLoopTurns} tool-loop turns`;
  if (input.reason === 'inspect-stall') {
    return (
      `Host stopped this run: the agent kept re-reading the same files (${counts}) ` +
      `instead of making a change. Send another message and ask it to implement the fix.`
    );
  }
  if (input.reason === 'max-turns') {
    return (
      `Host stopped this run after a ${input.toolLoopTurns}-turn tool loop (${counts}) ` +
      `with no finish. Send another message to continue.`
    );
  }
  return (
    `Host stopped this run: the agent searched for ${input.inspectOnlyTurns} turns ` +
    `without writing or editing a file (${counts}). Send another message and ask it to implement the change.`
  );
}

/**
 * Per-run inspect-loop counters. Host owns one instance and keys state by Run.
 */
export class ToolLoopProgressTracker {
  private readonly limits: ToolLoopLimits;
  private readonly states = new Map<string, RunLoopState>();

  constructor(limits: Partial<ToolLoopLimits> = {}) {
    this.limits = {
      ...DEFAULT_LIMITS,
      ...limits,
    };
  }

  observeTool(runId: string, observation: ToolLoopObservation): void {
    const state = this.getOrCreate(runId);
    if (state.stopped) {
      return;
    }
    const open = state.open ?? { inspect: false, progress: false, newFingerprint: false };
    const kind = classifyToolLoopClass(observation.toolName);
    if (kind === 'inspect') {
      open.inspect = true;
    } else if (kind === 'progress') {
      open.progress = true;
    }
    const fingerprint = fingerprintToolLoopCall(observation);
    if (!state.seenFingerprints.has(fingerprint)) {
      state.seenFingerprints.add(fingerprint);
      open.newFingerprint = true;
    }
    state.open = open;
  }

  closeAssistantTurn(runId: string): ToolLoopDecision {
    const state = this.states.get(runId);
    if (!state || state.stopped) {
      return { action: 'continue' };
    }
    const open = state.open;
    state.open = undefined;
    if (open === undefined || (!open.inspect && !open.progress)) {
      return { action: 'continue' };
    }
    state.toolLoopTurns += 1;
    if (open.progress) {
      state.inspectOnlyTurns = 0;
      state.stallRounds = 0;
    } else if (open.inspect) {
      state.inspectOnlyTurns += 1;
      if (open.newFingerprint) {
        state.stallRounds = 0;
      } else {
        state.stallRounds += 1;
      }
    }
    return this.evaluate(state);
  }

  release(runId: string): void {
    this.states.delete(runId);
  }

  snapshot(runId: string):
    | {
        inspectOnlyTurns: number;
        stallRounds: number;
        toolLoopTurns: number;
        stopped: boolean;
      }
    | undefined {
    const state = this.states.get(runId);
    if (!state) {
      return undefined;
    }
    return {
      inspectOnlyTurns: state.inspectOnlyTurns,
      stallRounds: state.stallRounds,
      toolLoopTurns: state.toolLoopTurns,
      stopped: state.stopped,
    };
  }

  private evaluate(state: RunLoopState): ToolLoopDecision {
    const inspectLimit = this.limits.maxInspectOnlyTurns;
    const stallLimit = this.limits.maxInspectStallRounds;
    const turnLimit = this.limits.maxToolLoopTurns;
    let reason: Extract<ToolLoopDecision, { action: 'stop' }>['reason'] | undefined;
    if (inspectLimit > 0 && state.inspectOnlyTurns >= inspectLimit) {
      reason = 'inspect-only';
    } else if (stallLimit > 0 && state.stallRounds >= stallLimit) {
      reason = 'inspect-stall';
    } else if (turnLimit > 0 && state.toolLoopTurns >= turnLimit) {
      reason = 'max-turns';
    }
    if (reason === undefined) {
      return { action: 'continue' };
    }
    state.stopped = true;
    return {
      action: 'stop',
      reason,
      inspectOnlyTurns: state.inspectOnlyTurns,
      stallRounds: state.stallRounds,
      toolLoopTurns: state.toolLoopTurns,
      message: formatToolLoopStopMessage({
        reason,
        inspectOnlyTurns: state.inspectOnlyTurns,
        stallRounds: state.stallRounds,
        toolLoopTurns: state.toolLoopTurns,
      }),
    };
  }

  private getOrCreate(runId: string): RunLoopState {
    const existing = this.states.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunLoopState = {
      inspectOnlyTurns: 0,
      stallRounds: 0,
      toolLoopTurns: 0,
      seenFingerprints: new Set<string>(),
      open: undefined,
      stopped: false,
    };
    this.states.set(runId, created);
    return created;
  }
}

function isProgressAlias(toolName: string): boolean {
  return (
    toolName.endsWith('_write') ||
    toolName.endsWith('_edit') ||
    toolName.includes('write') ||
    toolName.includes('edit') ||
    toolName.includes('replace') ||
    toolName.includes('patch')
  );
}

function isInspectAlias(toolName: string): boolean {
  if (toolName.startsWith('web_')) {
    return true;
  }
  return (
    toolName.startsWith('read_') ||
    toolName.endsWith('_read') ||
    toolName.includes('grep') ||
    toolName.includes('glob') ||
    toolName.includes('list_dir') ||
    toolName.includes('explore') ||
    (toolName.endsWith('_search') && !toolName.includes('glob')) ||
    toolName.includes('read') ||
    toolName.includes('view')
  );
}
