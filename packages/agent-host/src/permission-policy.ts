import type { PermissionDecision } from '@piwin/contracts';
import { isPrivateOrLocalHostname } from '@piwin/tools-web';


export type PermissionEvaluation = {
  decision: PermissionDecision;
  reason: string;
};

export type WebPermissionAction = 'web_search' | 'web_fetch';

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

/** Non-interactive CLI: never auto-approve ask. */
export function resolveNonInteractiveDecision(
  evaluation: PermissionEvaluation,
): Exclude<PermissionDecision, 'ask'> {
  if (evaluation.decision === 'ask') {
    return 'deny';
  }
  return evaluation.decision;
}
