/**
 * Unified Host permission admission gate (repair spec WP3).
 *
 * Every Agent-facing tool invocation passes through this gate after the
 * immediate safety check. The gate is the single decision point:
 *
 *   registration.permissionSpec
 *     → subjectBuilder(args, context)
 *     → frozen PermissionRuleSet (generation snapshot)
 *     → current PermissionMode (read once per call)
 *     → allow / ask / deny
 *
 * Executors no longer decide permissions; they only validate arguments and
 * perform the domain operation. Domain differences (bash, file, web, process,
 * MCP, notes, browser, delegate, planning) remain pure policies but are all
 * invoked from this one gate.
 */

import type {
  HostToolExecutionContext,
  HostToolRegistration,
  PermissionDecision,
  PermissionMode,
  PermissionRuleSet,
  PermissionSubject,
  ToolResult,
} from '@piwin/contracts';
import { formatError,  createEmptyNetworkPolicy } from '@piwin/contracts';
import { getProjectNetworkPolicy } from '@piwin/project';
import {
  evaluateBashPermission,
  evaluateFileWritePermission,
  evaluateNotesPermission,
  evaluateProcessPermission,
  evaluateWebPermission,
  resolveNonInteractiveDecision,
  type NotesPermissionAction,
  type PermissionEvaluation,
  type WebPermissionAction,
} from '../permission-policy.js';
import { evaluateBrowserNavigatePermission } from '../browser-tools.js';
import type {
  HostToolAdmissionDecision,
  HostToolPermissionGate,
} from './host-tool-execution-router.js';

export type HostToolAdmissionGateOptions = {
  /** Frozen rule set captured when the runtime generation was composed. */
  rules: PermissionRuleSet;
  /** Dynamic permission-mode getter (session override → host override → config). */
  getPermissionMode: () => PermissionMode;
  /** Dynamic in-memory approvals for this product session. */
  getSessionAllowlist?: (sessionId: string) =>
    | {
        hasBashCommand: (command: string) => boolean;
        hasFilePath: (path: string) => boolean;
      }
    | undefined;
  /** Interactive ask gate (Desktop via HostRuntime); absent → non-interactive deny. */
  requestPermission?: (input: {
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    signal?: AbortSignal;
  }) => Promise<PermissionDecision>;
  /** Working directory for file-write escape checks. */
  projectRoot: string;
  projectPath?: string;
  projectsFilePath?: string;
  /** Frozen MCP enabled-server allowlist (repair spec WP4). */
  mcpEnabledServerIds: readonly string[];
  /** Observe fail-closed policy lookup failures. */
  onDiagnostic?: (message: string) => void;
};

/**
 * Build the production admission gate. The returned gate is bound to the
 * generation snapshot (frozen rules + frozen MCP allowlist) and reads the
 * current PermissionMode once per invocation.
 */
export function createHostToolPermissionGate(
  options: HostToolAdmissionGateOptions,
): HostToolPermissionGate {
  return async ({ registration, args, context, signal }) => {
    try {
      const spec = registration.permissionSpec;

      // MCP is explicitly local-trust scoped. It is still routed through the
      // Host execution gate for generation/session ownership, but never enters
      // the permission rule engine or asks the user for a prompt.
      if (spec.admission === 'trusted') {
        return { allowed: true };
      }

      // Read-only tools pass the gate directly — but they still pass through
      // the port/router, never bypassing the execution path.
      if (spec.readOnly === true) {
        return { allowed: true };
      }

      const subject = spec.subjectBuilder?.(args, context);

      const evaluation = await evaluateAdmission(
        registration,
        subject,
        args,
        context,
        options,
        signal,
      );
      if (evaluation.kind === 'denied') {
        return { allowed: false, result: evaluation.result };
      }
      return { allowed: true };
    } catch (error) {
      const detail = formatUnknownError(error);
      const diagnostic = `permission admission failed for ${registration.descriptor.name}: ${detail}`;
      options.onDiagnostic?.(diagnostic);
      return {
        allowed: false,
        result: signal.aborted
          ? { ok: false, code: 'aborted', message: 'permission admission aborted' }
          : {
              ok: false,
              code: 'permission-denied',
              message: `Permission admission failed for ${registration.descriptor.name}`,
            },
      };
    }
  };
}

type AdmissionOutcome = { kind: 'allowed' } | { kind: 'denied'; result: ToolResult };

async function evaluateAdmission(
  registration: HostToolRegistration,
  subject: PermissionSubject | undefined,
  args: Record<string, unknown>,
  context: HostToolExecutionContext,
  options: HostToolAdmissionGateOptions,
  signal: AbortSignal,
): Promise<AdmissionOutcome> {
  const action = registration.permissionSpec.action;
  const mode = options.getPermissionMode();

  // Tools that require a concrete subject must produce one; an undefined
  // subject here means argument parsing failed before admission and must not
  // be treated as an empty-subject allow (WP3 rule 6).
  const requiresSubject =
    action === 'bash' ||
    action === 'file-write' ||
    action === 'network:web_fetch' ||
    action === 'network:web_search' ||
    action === 'network:image-gen' ||
    action === 'process:start' ||
    action === 'process:stop' ||
    action.startsWith('notes:') ||
    action === 'browser:navigate' ||
    action === 'browser:screenshot';

  if (requiresSubject && !subject) {
    return {
      kind: 'denied',
      result: {
        ok: false,
        code: 'invalid-input',
        message: `could not build permission subject for ${registration.descriptor.name}`,
      },
    };
  }

  const evaluation = resolveDomainPolicy(action, subject, args, mode, options);

  let decision: PermissionDecision = evaluation.decision;
  if (
    decision !== 'deny' &&
    isRememberedSessionAllow(action, subject, context.sessionId, options)
  ) {
    decision = 'allow';
  }
  if (decision === 'ask') {
    if (action === 'network:web_search' || action === 'network:web_fetch') {
      const target =
        action === 'network:web_search' ? String(args.query ?? '') : String(args.url ?? '');
      if (
        await isRememberedNetworkAllow(
          action.slice('network:'.length) as WebPermissionAction,
          target,
          options,
        )
      ) {
        decision = 'allow';
      }
    }
    if (decision === 'ask' && options.requestPermission && !signal.aborted) {
      decision = await options.requestPermission({
        action,
        detail: buildPermissionDetail(action, subject, args, evaluation.reason),
        defaultDecision: 'ask',
        ...(signal ? { signal } : {}),
      });
    } else if (decision === 'ask') {
      decision = resolveNonInteractiveDecision(evaluation);
    }
  }

  if (decision !== 'allow') {
    return {
      kind: 'denied',
      result: {
        ok: false,
        code: 'permission-denied',
        message: `Permission ${decision} for ${registration.descriptor.name}: ${evaluation.reason}`,
      },
    };
  }
  return { kind: 'allowed' };
}

function isRememberedSessionAllow(
  action: string,
  subject: PermissionSubject | undefined,
  sessionId: string,
  options: HostToolAdmissionGateOptions,
): boolean {
  const allowlist = options.getSessionAllowlist?.(sessionId);
  if (!allowlist) {
    return false;
  }
  if (action === 'bash' && subject?.kind === 'bash') {
    return allowlist.hasBashCommand(subject.command);
  }
  if (action === 'file-write' && subject?.kind === 'file-write') {
    return allowlist.hasFilePath(subject.path);
  }
  return false;
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
  if (action === 'network:web_search') {
    return String(args.query ?? '');
  }
  if (action === 'network:web_fetch' || action === 'browser:navigate') {
    return String(args.url ?? '');
  }
  if (action === 'browser:screenshot') {
    return subject?.kind === 'file-write' ? subject.path : reason;
  }
  if (action.startsWith('notes:')) {
    return String(args.noteId ?? args.query ?? args.content ?? reason);
  }
  return reason;
}

/** Pure per-domain policy dispatch. All paths share the same dynamic mode. */
function resolveDomainPolicy(
  action: string,
  subject: PermissionSubject | undefined,
  args: Record<string, unknown>,
  mode: PermissionMode,
  options: HostToolAdmissionGateOptions,
): PermissionEvaluation {
  switch (action) {
    case 'bash': {
      const command = subject?.kind === 'bash' ? subject.command : String(args.command ?? '');
      return evaluateBashPermission(command, mode, options.rules);
    }
    case 'file-write': {
      const path = subject?.kind === 'file-write' ? subject.path : String(args.path ?? '');
      return evaluateFileWritePermission({
        absPath: path,
        projectRoot: options.projectRoot,
        mode,
        rules: options.rules,
      });
    }
    case 'network:web_fetch':
      return evaluateWebPermission('web_fetch', String(args.url ?? ''), options.rules, mode);
    case 'network:web_search':
      return evaluateWebPermission('web_search', String(args.query ?? ''), options.rules, mode);
    case 'network:image-gen': {
      // Image generation is a paid network call; reuse web-fetch host rules.
      const url = String(args.model ?? '');
      const evaluation = evaluateWebPermission(
        'web_fetch',
        subject?.kind === 'web-fetch' ? `https://${subject.host}` : 'https://image.example',
        options.rules,
        mode,
      );
      void url;
      return evaluation;
    }
    case 'process:start':
    case 'process:stop':
      return evaluateProcessPermission(action, options.rules, mode);
    case 'browser:navigate':
      return evaluateBrowserNavigatePermission(String(args.url ?? ''), options.rules, mode);
    case 'browser:screenshot':
      if (subject?.kind === 'file-write') {
        return evaluateFileWritePermission({
          absPath: subject.path,
          projectRoot: options.projectRoot,
          mode,
          rules: options.rules,
        });
      }
      return {
        decision: mode === 'ask-all' ? 'ask' : 'allow',
        reason: mode === 'ask-all' ? 'ask-all-browser-screenshot' : 'browser-screenshot',
      };
    default:
      if (action.startsWith('notes:')) {
        const noteAction = action.slice('notes:'.length) as NotesPermissionAction;
        const detail =
          typeof args.noteId === 'string'
            ? args.noteId
            : typeof args.query === 'string'
              ? args.query
              : typeof args.content === 'string'
                ? args.content.slice(0, 120)
                : '';
        return evaluateNotesPermission(noteAction, detail, mode, options.rules);
      }
      if (action.startsWith('flashcards:')) {
        return {
          decision: mode === 'bypass' ? 'allow' : 'ask',
          reason: `${action} mutation requires review`,
        };
      }
      if (action === 'subagent:run') {
        return {
          decision: mode === 'bypass' ? 'allow' : 'ask',
          reason: mode === 'bypass' ? 'bypass-delegate' : 'subagent-spawn',
        };
      }
      if (action.startsWith('planning:')) {
        return {
          // Planning tools only mutate Host-owned product state under
          // ~/.piwin/sessions. They are the narrow write exception that lets
          // Plan/Ask keep the project workspace read-only while still
          // producing a durable, reviewable artifact.
          decision: 'allow',
          reason: 'host-owned-planning-artifact',
        };
      }
      if (action.startsWith('browser:')) {
        return {
          decision: mode === 'ask-all' ? 'ask' : 'allow',
          reason: mode === 'ask-all' ? 'ask-all-browser-interaction' : 'browser-interaction',
        };
      }
      return { decision: 'allow', reason: 'unclassified-tool' };
  }
}

/** Project-remembered network allow (web_search / web_fetch). */
async function isRememberedNetworkAllow(
  action: WebPermissionAction,
  target: string,
  options: HostToolAdmissionGateOptions,
): Promise<boolean> {
  if (!options.projectPath || !options.projectsFilePath) {
    return false;
  }
  let policy: import('@piwin/contracts').ProjectNetworkPolicy;
  try {
    policy = await getProjectNetworkPolicy(options.projectsFilePath, options.projectPath);
  } catch (error) {
    const message = `remembered network policy lookup failed; falling back to the frozen rule set: ${formatUnknownError(error)}`;
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

function formatUnknownError(error: unknown): string {
  return formatError(error);
}
