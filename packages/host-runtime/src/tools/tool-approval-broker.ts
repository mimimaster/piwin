/**
 * Session/project memory and interactive approval. Does not write memory.
 */

import type {
  HostToolExecutionContext,
  HostToolRegistration,
  PermissionDecision,
  PermissionSubject,
} from '@piwin/contracts';
import { createEmptyNetworkPolicy, formatError } from '@piwin/contracts';
import { getProjectNetworkPolicy } from '@piwin/project';
import { resolveNonInteractiveDecision } from '../permission-policy.js';
import type { WebPermissionAction } from '../permission-policy.js';
import type { SessionWorkspaceGrant } from '../session-allowlist.js';
import type { ToolPolicyDecision } from './tool-policy-evaluator.js';

export type ToolApprovalOutcome =
  | {
      allowed: true;
      source: 'session-memory' | 'project-memory' | 'user' | 'subagent-worktree';
    }
  | { allowed: false; reason: string };

export type ToolApprovalBroker = {
  resolve(input: {
    invocationId: string;
    registration: HostToolRegistration;
    arguments: Record<string, unknown>;
    context: HostToolExecutionContext;
    policy: ToolPolicyDecision;
    signal: AbortSignal;
  }): Promise<ToolApprovalOutcome>;
};

export type ToolApprovalBrokerOptions = {
  getSessionAllowlist?: (sessionId: string) =>
    | {
        hasBashCommand: (command: string) => boolean;
        hasFilePath: (path: string) => boolean;
        hasWorkspacePath?: (path: string) => boolean;
      }
    | undefined;
  requestPermission?: (input: {
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    policyReason?: string;
    cwd?: string;
    command?: string;
    paths?: readonly string[];
    /** What "Allow for session" grants: the directory joins the session boundary. */
    sessionGrant?: SessionWorkspaceGrant;
    signal?: AbortSignal;
  }) => Promise<PermissionDecision>;
  /**
   * Worktree-isolated subagents only: settle an `rm-recursive-force` ask without
   * a prompt when every target provably stays inside the child's own copy.
   */
  autoApproveRecursiveRemove?: (command: string) => Promise<boolean>;
  projectPath?: string;
  projectsFilePath?: string;
  onDiagnostic?: (message: string) => void;
};

export function createToolApprovalBroker(options: ToolApprovalBrokerOptions): ToolApprovalBroker {
  return {
    async resolve(input) {
      if (input.policy.decision === 'deny') {
        return { allowed: false, reason: input.policy.reason };
      }
      if (input.policy.decision === 'allow') {
        return { allowed: true, source: 'user' };
      }

      if (
        isRememberedSessionAllow(
          input.policy.action,
          input.policy.subject,
          input.context.sessionId,
          options,
        )
      ) {
        return { allowed: true, source: 'session-memory' };
      }

      if (
        input.policy.action === 'network:web_search' ||
        input.policy.action === 'network:web_fetch'
      ) {
        const target =
          input.policy.action === 'network:web_search'
            ? String(input.arguments.query ?? '')
            : String(input.arguments.url ?? '');
        if (
          await isRememberedNetworkAllow(
            input.policy.action.slice('network:'.length) as WebPermissionAction,
            target,
            options,
          )
        ) {
          return { allowed: true, source: 'project-memory' };
        }
      }

      if (
        options.autoApproveRecursiveRemove &&
        input.policy.action === 'bash' &&
        /(^|:)rm-recursive-force$/.test(input.policy.reason) &&
        (await options.autoApproveRecursiveRemove(String(input.arguments.command ?? '')))
      ) {
        return { allowed: true, source: 'subagent-worktree' };
      }

      if (options.requestPermission && !input.signal.aborted) {
        const sessionGrant = resolveSessionGrant(input.policy.action, input.policy.subject);
        const decision = await options.requestPermission({
          action: input.policy.action,
          detail: buildPermissionDetail(
            input.policy.action,
            input.policy.subject,
            input.arguments,
            input.policy.reason,
          ),
          defaultDecision: 'ask',
          policyReason: input.policy.reason,
          ...(input.policy.subject?.kind === 'process' && input.policy.subject.cwd
            ? { cwd: input.policy.subject.cwd }
            : {}),
          ...(input.policy.action === 'process:start'
            ? { command: [String(input.arguments.command ?? ''), ...(Array.isArray(input.arguments.argv) ? input.arguments.argv.map(String) : [])].join(' ').trim() }
            : {}),
          ...(input.policy.subject?.kind === 'file-paths'
            ? { paths: input.policy.subject.paths }
            : input.policy.subject?.kind === 'file-write'
              ? { paths: [input.policy.subject.path] }
              : {}),
          ...(sessionGrant ? { sessionGrant } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return decision === 'allow'
          ? { allowed: true, source: 'user' }
          : { allowed: false, reason: input.policy.reason };
      }

      const nonInteractive = resolveNonInteractiveDecision({
        decision: 'ask',
        reason: input.policy.reason,
      });
      return nonInteractive === 'allow'
        ? { allowed: true, source: 'user' }
        : { allowed: false, reason: input.policy.reason };
    },
  };
}

function isRememberedSessionAllow(
  action: string,
  subject: PermissionSubject | undefined,
  sessionId: string,
  options: ToolApprovalBrokerOptions,
): boolean {
  const allowlist = options.getSessionAllowlist?.(sessionId);
  if (!allowlist) {
    return false;
  }
  if (action === 'bash' && subject?.kind === 'bash') {
    return allowlist.hasBashCommand(subject.command);
  }
  if (action === 'file-write' && subject?.kind === 'file-write') {
    return allowlist.hasFilePath(subject.path) || allowlist.hasWorkspacePath?.(subject.path) === true;
  }
  if (action === 'browser:upload' && subject?.kind === 'file-paths') {
    return subject.paths.length > 0 && subject.paths.every(
      (path) => allowlist.hasFilePath(path) || allowlist.hasWorkspacePath?.(path) === true,
    );
  }
  if (action === 'browser:screenshot' && subject?.kind === 'file-write') {
    return allowlist.hasFilePath(subject.path) || allowlist.hasWorkspacePath?.(subject.path) === true;
  }
  if (action === 'process:start' && subject?.kind === 'process' && subject.cwd !== undefined) {
    return allowlist.hasWorkspacePath?.(subject.cwd) === true;
  }
  return false;
}

/**
 * A Job start's "Allow for session" grants its cwd directory. Browser uploads
 * and screenshots remember only the exact approved paths; granting a parent
 * directory for one upload would expose unrelated files.
 */
function resolveSessionGrant(
  action: string,
  subject: PermissionSubject | undefined,
): SessionWorkspaceGrant | undefined {
  if (action === 'process:start' && subject?.kind === 'process' && subject.cwd) {
    return { directory: subject.cwd };
  }
  if (action === 'browser:upload' && subject?.kind === 'file-paths' && subject.paths.length > 0) {
    return { filePaths: subject.paths };
  }
  if (action === 'browser:screenshot' && subject?.kind === 'file-write') {
    return { filePaths: [subject.path] };
  }
  return undefined;
}

function buildPermissionDetail(
  action: string,
  subject: PermissionSubject | undefined,
  args: Record<string, unknown>,
  reason: string,
): string {
  if (action === 'bash') {
    const command = subject?.kind === 'bash' ? subject.command : String(args.command ?? '');
    return `${reason}: ${command}`;
  }
  if (action === 'file-write') {
    return subject?.kind === 'file-write' ? subject.path : String(args.path ?? '');
  }
  if (action === 'process:start') {
    // Name the directory and what would run there, not just the reason code.
    const cwd = subject?.kind === 'process' && subject.cwd ? subject.cwd : '';
    const argv = Array.isArray(args.argv) ? args.argv.map(String).join(' ') : '';
    const commandLine = `${String(args.command ?? '')} ${argv}`.trim();
    return [cwd ? `${reason}: ${cwd}` : reason, commandLine].filter(Boolean).join('\n$ ');
  }
  if (action === 'network:web_search') {
    return String(args.query ?? '');
  }
  if (action === 'network:web_fetch' || action === 'browser:navigate') {
    return String(args.url ?? '');
  }
  if (action === 'browser:screenshot') {
    return subject?.kind === 'file-write' ? subject.path : reason;
  }
  if (action === 'browser:upload') {
    return subject?.kind === 'file-paths' ? subject.paths.join('\n') : reason;
  }
  if (action.startsWith('notes:')) {
    return String(args.noteId ?? args.query ?? args.content ?? reason);
  }
  return reason;
}

async function isRememberedNetworkAllow(
  action: WebPermissionAction,
  target: string,
  options: ToolApprovalBrokerOptions,
): Promise<boolean> {
  if (!options.projectPath || !options.projectsFilePath) {
    return false;
  }
  let policy: import('@piwin/contracts').ProjectNetworkPolicy;
  try {
    policy = await getProjectNetworkPolicy(options.projectsFilePath, options.projectPath);
  } catch (error) {
    const message = `remembered network policy lookup failed; falling back to the frozen rule set: ${formatError(error)}`;
    options.onDiagnostic?.(message);
    if (!options.onDiagnostic) {
      console.warn(`[host-runtime] ${message}`);
    }
    policy = createEmptyNetworkPolicy();
  }
  if (action === 'web_search') {
    return policy.allowWebSearch === true;
  }
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return policy.allowedFetchHosts.includes(hostname);
  } catch {
    return false;
  }
}
