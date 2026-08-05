import type { PermissionDecision, PermissionMode, PermissionRuleSet } from '@piwin/contracts';
import { escapesRoot } from '@piwin/project';
import { isPrivateOrLocalHostname } from '@piwin/tools-web';
import { findMatchingRule } from './permission-rule-engine.js';
import { createBundledRuleSet } from './permission-defaults.js';

export type PermissionEvaluation = {
  decision: PermissionDecision;
  reason: string;
};

export type WebPermissionAction = 'web_search' | 'web_fetch';

/**
 * Classify a bash command for host permission gating (ADR 0019 §1, §3.1).
 *
 * Delegates to the rule engine: deny → ask → allow, first match wins. When no
 * `rules` are supplied the bundled defaults are used, preserving the legacy
 * hardcoded decisions (pipe-to-shell deny, rm-recursive-force ask, etc.) with
 * stable reason strings. On `'no-match'`: `allow` for `auto`/`bypass`, `ask`
 * for `ask-all`.
 *
 * Pure function — no IO.
 */
export function evaluateBashPermission(
  command: string,
  mode: PermissionMode = 'auto',
  rules?: PermissionRuleSet,
): PermissionEvaluation {
  const normalized = command.trim();
  if (!normalized) {
    return { decision: 'deny', reason: 'empty command' };
  }

  const ruleSet = rules ?? createBundledRuleSet();
  const matched = findMatchingRule({ kind: 'bash', command: normalized }, ruleSet);
  if (matched) {
    return { decision: matched.decision, reason: matched.reason };
  }

  // No rule matched: ask-all escalates everything to ask; auto/bypass allow.
  if (mode === 'ask-all') {
    return { decision: 'ask', reason: 'ask-all-no-match' };
  }
  return { decision: 'allow', reason: 'default-allow' };
}

/**
 * Classify a file-write operation (ADR 0019 §1, §4).
 *
 * 1. `evaluateRules` for `{ kind: 'file-write', path: absPath }`.
 * 2. On match → that decision + reason.
 * 3. On `'no-match'`:
 *    - `bypass` → allow (deny already handled above).
 *    - `escapesRoot(projectRoot, absPath)` → ask (`auto` / `ask-all`).
 *    - else in-project → allow in `auto`/`bypass`, ask in `ask-all`.
 *
 * Pure — no FS. The caller is expected to realpath-resolve `absPath` when
 * possible so symlink-aware checks happen before this function.
 */
export function evaluateFileWritePermission(input: {
  absPath: string;
  projectRoot: string;
  mode: PermissionMode;
  rules?: PermissionRuleSet;
}): PermissionEvaluation {
  const { absPath, projectRoot, mode, rules } = input;
  const normalizedPath = absPath.trim();
  if (!normalizedPath) {
    return { decision: 'deny', reason: 'empty-path' };
  }

  const ruleSet = rules ?? createBundledRuleSet();
  const matched = findMatchingRule({ kind: 'file-write', path: normalizedPath }, ruleSet);
  if (matched) {
    return { decision: matched.decision, reason: matched.reason };
  }

  if (mode === 'bypass') {
    return { decision: 'allow', reason: 'bypass-no-match' };
  }

  if (escapesRoot(projectRoot, normalizedPath)) {
    return { decision: 'ask', reason: 'path-escapes-project-root' };
  }

  if (mode === 'ask-all') {
    return { decision: 'ask', reason: 'ask-all-in-project' };
  }
  return { decision: 'allow', reason: 'in-project-allow' };
}

/**
 * Classify network tools before they reach the wire (ADR 0019 §1).
 *
 * Hard-denies local/file targets; default asks for public network use. When
 * `rules` are supplied, the rule engine is consulted first for `web-fetch`/
 * `web-search` subjects; on `'no-match'` the domain defaults below apply. The
 * default behavior is unchanged when `rules` is omitted.
 */
export function evaluateWebPermission(
  action: WebPermissionAction,
  target: string,
  rules?: PermissionRuleSet,
): PermissionEvaluation {
  const normalized = target.trim();
  if (!normalized) {
    return { decision: 'deny', reason: 'empty-target' };
  }

  if (rules) {
    if (action === 'web_fetch') {
      let host: string | undefined;
      try {
        host = new URL(normalized).hostname.toLowerCase();
      } catch {
        host = undefined;
      }
      if (host) {
        const matched = findMatchingRule({ kind: 'web-fetch', host }, rules);
        if (matched) {
          return { decision: matched.decision, reason: matched.reason };
        }
      }
    } else {
      const matched = findMatchingRule({ kind: 'web-search' }, rules);
      if (matched) {
        return { decision: matched.decision, reason: matched.reason };
      }
    }
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

export type NotesPermissionAction =
  'note_list' | 'note_search' | 'note_read' | 'note_write' | 'note_update' | 'note_delete';

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
export function evaluateProcessPermission(action: ProcessPermissionAction): PermissionEvaluation {
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

export type McpToolRisk =
  'read' | 'network' | 'external-write' | 'local-write' | 'process' | 'credential' | 'unknown';

const READ_TOOL_NAME_HINTS = /^(get_|list_|search_|find_|read_|fetch_|query_|describe_|lookup_)/i;
const WRITE_TOOL_NAME_HINTS =
  /^(write_|create_|update_|delete_|remove_|put_|post_|patch_|send_|upload_|install_)/i;
const PROCESS_TOOL_NAME_HINTS = /^(run_|exec_|spawn_|bash|shell|terminal)/i;
const CREDENTIAL_TOOL_NAME_HINTS = /(auth|token|secret|password|credential|api[_-]?key)/i;
const NETWORK_TOOL_NAME_HINTS = /(http|fetch|request|webhook|email|slack|browser)/i;

const SECRET_ARG_KEYS =
  /^(password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|auth|cookie|private[_-]?key)$/i;

/**
 * Classify an MCP tool call's risk for permission UI display.
 *
 * Pure function — server descriptions are untrusted hints only. The returned
 * `decision`/`reason` are used for surfacing risk to the user; the actual
 * call/allow decision for MCP tools is driven by the rule engine in
 * `assertMcpToolCallAllowed` (ADR 0019 §5). This classification is display-only.
 */
export function evaluateMcpToolCallRisk(input: {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}): PermissionEvaluation & { risk: McpToolRisk } {
  const toolName = input.toolName.trim();
  if (!toolName) {
    return { decision: 'deny', reason: 'empty-tool-name', risk: 'unknown' };
  }

  if (CREDENTIAL_TOOL_NAME_HINTS.test(toolName)) {
    return { decision: 'ask', reason: 'mcp-credential', risk: 'credential' };
  }
  if (PROCESS_TOOL_NAME_HINTS.test(toolName)) {
    return { decision: 'ask', reason: 'mcp-process', risk: 'process' };
  }
  if (WRITE_TOOL_NAME_HINTS.test(toolName)) {
    const risk: McpToolRisk = NETWORK_TOOL_NAME_HINTS.test(toolName)
      ? 'external-write'
      : 'local-write';
    return { decision: 'ask', reason: `mcp-write:${risk}`, risk };
  }
  if (NETWORK_TOOL_NAME_HINTS.test(toolName)) {
    return { decision: 'ask', reason: 'mcp-network', risk: 'network' };
  }
  if (READ_TOOL_NAME_HINTS.test(toolName)) {
    // A server controls its tool names. A read-looking name is useful for
    // displaying risk, but cannot be trusted as an authorization decision.
    return { decision: 'ask', reason: 'mcp-read-review', risk: 'read' };
  }

  // Unknown tools always ask — never trust server-supplied "safe" claims.
  return { decision: 'ask', reason: 'mcp-unknown', risk: 'unknown' };
}

/** Redact secret-like keys and bound summary length for permission UI/logs. */
export function redactMcpArgumentsSummary(args: Record<string, unknown>, maxLength = 280): string {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_ARG_KEYS.test(key)) {
      redacted[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && value.length > 80) {
      redacted[key] = `${value.slice(0, 80)}…`;
      continue;
    }
    redacted[key] = value;
  }
  let text: string;
  try {
    text = JSON.stringify(redacted);
  } catch {
    text = String(redacted);
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}
