/**
 * Replace Pi built-in bash with a permission-gated bash tool.
 * Deny hard-patterns immediately; ask UI for destructive patterns.
 */
import type { PermissionDecision, PermissionMode, PermissionRuleSet } from '@piwin/contracts';
import { commandInBashAllowlist, getBashAllowlist } from '@piwin/project';
import { evaluateBashPermission, resolveNonInteractiveDecision } from './permission-policy.js';
import type { SessionAllowlist } from './session-allowlist.js';
import { formatRunAbortReason } from './run-abort-reason.js';

export type GatedBashPermissionRequest = {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
};

export type BuildGatedBashToolOptions = {
  cwd: string;
  /** Path to `~/.piwin/projects.json`; read once for the remembered allowlist. */
  projectsFilePath?: string;
  /** Project path key for the project-store lookup (defaults to `cwd`). */
  projectPath?: string;
  /** Permission mode from `config.permissions` (default `'auto'`). */
  mode?: PermissionMode;
  /** Dynamic permission mode override (per-prompt agent mode). When set,
   *  the effective mode is `getMode()` instead of the static `mode`. */
  getMode?: () => PermissionMode;
  /** Merged rule set (bundled + user + project layers). */
  rules?: PermissionRuleSet;
  /** In-memory session allowlist (ADR 0024 §4). */
  sessionAllowlist?: SessionAllowlist;
  requestPermission?: (request: GatedBashPermissionRequest) => Promise<PermissionDecision>;
};

/**
 * Build a Pi ToolDefinition for bash that enforces piwin permission policy.
 * Register as customTools name "bash" so it overrides the built-in definition.
 */
export async function buildGatedBashToolDefinition(
  options: BuildGatedBashToolOptions,
): Promise<unknown> {
  const {
    createPiBashToolDefinition,
    createPiLocalBashOperations,
  } = await import('@piwin/agent-host');

  // Load the remembered bash allowlist once per session. Entries are exact
  // command strings approved by the user (Settings → remembered permissions);
  // an exact match auto-allows without prompting (ADR 0019 §6).
  let allowlist: string[] = [];
  if (options.projectsFilePath) {
    try {
      allowlist = await getBashAllowlist(
        options.projectsFilePath,
        options.projectPath ?? options.cwd,
      );
    } catch (error) {
      // Best-effort: a missing/unreadable store simply means no remembered allows.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] bash allowlist unavailable: ${message}`);
    }
  }

  const localOps = await createPiLocalBashOperations();
  const requestPermission = options.requestPermission;
  const staticMode = options.mode ?? 'auto';
  const getMode = options.getMode;
  const rules = options.rules;
  const sessionAllowlist = options.sessionAllowlist;

  /**
   * Run local bash, rewriting bare Pi "aborted" errors into a model-readable
   * cancel reason (user-stop / superseded / etc.) from AbortSignal.reason.
   */
  async function execWithCancelReason(
    command: string,
    cwd: string,
    execOptions: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ): Promise<{ exitCode: number | null }> {
    try {
      return await localOps.exec(command, cwd, execOptions);
    } catch (error) {
      const signal = execOptions.signal;
      const message = error instanceof Error ? error.message : String(error);
      const looksAborted =
        signal?.aborted === true ||
        message === 'aborted' ||
        message === 'Command aborted' ||
        message.startsWith('Command aborted');
      if (!looksAborted) {
        throw error;
      }
      const detail = formatRunAbortReason(signal?.reason);
      throw new Error(`Command aborted: ${detail}`);
    }
  }

  return createPiBashToolDefinition(options.cwd, async (command, cwd, execOptions) => {
    // Remembered approvals short-circuit before the evaluator / prompt.
    if (allowlist.length > 0 && commandInBashAllowlist(command, allowlist)) {
      return execWithCancelReason(command, cwd, execOptions);
    }

    // Session-scoped approvals (ADR 0024 §4): in-memory, per-session only.
    if (sessionAllowlist?.hasBashCommand(command)) {
      return execWithCancelReason(command, cwd, execOptions);
    }

    const effectiveMode = getMode ? getMode() : staticMode;
    const evaluation = evaluateBashPermission(command, effectiveMode, rules);
    let decision: PermissionDecision = evaluation.decision;

    if (decision === 'ask') {
      if (requestPermission) {
        decision = await requestPermission({
          action: 'bash',
          detail: `${evaluation.reason}: ${command}`,
          defaultDecision: 'ask',
          ...(execOptions.signal ? { signal: execOptions.signal } : {}),
        });
      } else {
        decision = resolveNonInteractiveDecision(evaluation);
      }
    }

    if (decision !== 'allow') {
      const message = `piwin blocked bash (${evaluation.reason}): ${command}` + '\n';
      execOptions.onData(Buffer.from(message, 'utf8'));
      return { exitCode: 1 };
    }

    return execWithCancelReason(command, cwd, execOptions);
  });
}
