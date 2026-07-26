import type { PermissionDecision } from '@piwin/contracts';
import { isPrivateOrLocalHostname } from '@piwin/tools-web';


export type PermissionEvaluation = {
  decision: PermissionDecision;
  reason: string;
};

export type WebPermissionAction = 'web_search' | 'web_fetch';

export type MemoryPermissionAction =
  | 'memory_list'
  | 'memory_search'
  | 'memory_read'
  | 'memory_write'
  | 'memory_update'
  | 'memory_delete'
  | 'memory_accept';

const DENY_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'pipe-to-shell', pattern: /curl\s+[^\n|]*\|\s*(?:ba)?sh/i },
  { name: 'wget-pipe-shell', pattern: /wget\s+[^\n|]*\|\s*(?:ba)?sh/i },
  { name: 'mkfs', pattern: /\bmkfs\b/i },
  { name: 'disk-destroy', pattern: /dd\s+if=.+\s+of=\/dev\//i },
  { name: 'rm-root', pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\s+(\/\s*$|\/\*\s*$|\/~\s*$|~\s*$)/i },
  { name: 'fork-bomb', pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/ },
  { name: 'shutdown', pattern: /\b(shutdown|reboot|halt|poweroff)\b/i },
  { name: 'curl-eval', pattern: /curl\s+[^\n;|&]*\|\s*(?:python|perl|ruby|node)\b/i },
];

const ASK_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'rm-recursive-force', pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b/i },
  { name: 'sudo', pattern: /\bsudo\b/i },
  { name: 'force-push', pattern: /\bgit\s+push\b[^\n]*\s--force\b/i },
  { name: 'force-with-lease', pattern: /\bgit\s+push\b[^\n]*\s--force-with-lease\b/i },
  { name: 'write-env', pattern: /(?:^|[;&|])\s*(?:tee|cp|mv|echo|cat)\b[^\n]*\.env\b/i },
  { name: 'chmod-777', pattern: /\bchmod\s+(-R\s+)?777\b/i },
];

/**
 * Classify a bash command for host permission gating.
 * Pure function — no IO.
 */
export function evaluateBashPermission(command: string): PermissionEvaluation {
  const normalized = command.trim();
  if (!normalized) {
    return { decision: 'deny', reason: 'empty command' };
  }

  for (const rule of DENY_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { decision: 'deny', reason: rule.name };
    }
  }

  for (const rule of ASK_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { decision: 'ask', reason: rule.name };
    }
  }

  return { decision: 'allow', reason: 'default-allow' };
}

/**
 * Classify network tools before they reach the wire.
 * Hard-denies local/file targets; default asks for public network use.
 */
export function evaluateWebPermission(
  action: WebPermissionAction,
  target: string,
): PermissionEvaluation {
  const normalized = target.trim();
  if (!normalized) {
    return { decision: 'deny', reason: 'empty-target' };
  }

  if (action === 'web_fetch') {
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      return { decision: 'deny', reason: 'invalid-url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { decision: 'deny', reason: 'blocked-scheme' };
    }
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHostname(host)) {
      return { decision: 'deny', reason: 'private-or-local-target' };
    }
    return {
      decision: 'ask',
      reason: `fetch:${host}`,
    };
  }

  // web_search
  if (normalized.length > 500) {
    return { decision: 'deny', reason: 'query-too-long' };
  }
  return {
    decision: 'ask',
    reason: 'search-query',
  };
}



/**
 * Memory tools: read/list/search allow by default; mutating ops ask (Desktop) / deny (CLI).
 */
export function evaluateMemoryPermission(
  action: MemoryPermissionAction,
  detail: string,
): PermissionEvaluation {
  const normalized = detail.trim();
  if (
    action === 'memory_write' ||
    action === 'memory_update' ||
    action === 'memory_delete' ||
    action === 'memory_accept'
  ) {
    if (action === 'memory_write' && normalized.length === 0) {
      return { decision: 'deny', reason: 'empty-content' };
    }
    if (
      (action === 'memory_update' ||
        action === 'memory_delete' ||
        action === 'memory_accept') &&
      normalized.length === 0
    ) {
      return { decision: 'deny', reason: 'empty-memory-id' };
    }
    return {
      decision: 'ask',
      reason: `memory-mutate:${action}`,
    };
  }
  if (action === 'memory_search' && normalized.length > 500) {
    return { decision: 'deny', reason: 'query-too-long' };
  }
  return { decision: 'allow', reason: 'memory-read' };
}

export type NotesPermissionAction =
  | 'note_list'
  | 'note_search'
  | 'note_read'
  | 'note_write'
  | 'note_update'
  | 'note_delete';

/**
 * Notes tools: read/list/search allow by default; mutating ops ask
 * (same policy tier as memory writes, ADR 0018).
 */
export function evaluateNotesPermission(
  action: NotesPermissionAction,
  detail: string,
): PermissionEvaluation {
  const normalized = detail.trim();
  if (action === 'note_write' || action === 'note_update' || action === 'note_delete') {
    if (normalized.length === 0) {
      return {
        decision: 'deny',
        reason: action === 'note_write' ? 'empty-content' : 'empty-note-id',
      };
    }
    return { decision: 'ask', reason: `notes-mutate:${action}` };
  }
  if (action === 'note_search' && normalized.length > 500) {
    return { decision: 'deny', reason: 'query-too-long' };
  }
  return { decision: 'allow', reason: 'notes-read' };
}

export type ProcessPermissionAction = 'process:start' | 'process:stop';

/**
 * Managed process tools: start/stop always ask (Desktop) or deny non-interactive.
 * list/logs are read-only and are not gated here.
 */
export function evaluateProcessPermission(
  action: ProcessPermissionAction,
): PermissionEvaluation {
  if (action === 'process:start') {
    return { decision: 'ask', reason: 'process-start' };
  }
  if (action === 'process:stop') {
    return { decision: 'ask', reason: 'process-stop' };
  }
  return { decision: 'deny', reason: 'unknown-process-action' };
}

/** Non-interactive CLI: never auto-approve ask. */
export function resolveNonInteractiveDecision(
  evaluation: PermissionEvaluation,
): Exclude<PermissionDecision, 'ask'> {
  if (evaluation.decision === 'ask') {
    return 'deny';
  }
  return evaluation.decision;
}
