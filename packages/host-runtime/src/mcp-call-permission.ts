import type { McpToolCallTarget, PermissionDecision, PermissionRuleSet } from '@piwin/contracts';
import { evaluateMcpToolCallRisk, redactMcpArgumentsSummary } from './permission-policy.js';
import { evaluateRules } from './permission-rule-engine.js';
import type { ToolPermissionGate } from './session-tools.js';

export type McpCallPermissionInput = {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  /**
   * Merged permission ruleset (bundled + user/project layers). When omitted,
   * MCP tool calls are allowed without prompting — an enabled MCP server is
   * treated as trusted (ADR 0019 §5). Explicit deny/ask rules in this ruleset
   * still apply: deny blocks, ask prompts when `requestPermission` is present.
   */
  rules?: PermissionRuleSet;
  /**
   * Interactive permission gate (Desktop via HostRuntime). Used only for
   * explicit `ask` rules; without it, ask degrades to a non-interactive deny.
   */
  requestPermission?: ToolPermissionGate;
  signal?: AbortSignal;
};

/**
 * Shared MCP tool-call gate for direct tools and mcp_gateway call.
 *
 * ADR 0019 §5: an enabled MCP server is trusted by default — no per-call
 * prompt unless an explicit `ask` rule matches. Risk classification +
 * argument redaction still run for UI display. The rule engine is consulted
 * with `{ kind: 'mcp', selector }` against the merged ruleset:
 * - `deny` → throw
 * - `ask` → prompt only if `requestPermission` (else non-interactive deny)
 * - `allow` or `no-match` → allow (enabled server = trusted)
 *
 * When no `rules` are supplied the default is **allow** with no prompt.
 */
export async function assertMcpToolCallAllowed(
  input: McpCallPermissionInput,
): Promise<McpToolCallTarget> {
  const evaluation = evaluateMcpToolCallRisk({
    serverId: input.serverId,
    toolName: input.toolName,
    arguments: input.arguments,
  });
  const selector = `${input.serverId}.${input.toolName}`;
  const target: McpToolCallTarget = {
    serverId: input.serverId,
    toolName: input.toolName,
    selector,
    risk: evaluation.risk,
    argumentsSummary: redactMcpArgumentsSummary(input.arguments),
  };

  // Rule engine drives the decision; risk classification is display-only.
  let decision: PermissionDecision = 'allow';
  let reason = 'mcp-enabled-server-trusted';
  if (input.rules) {
    const ruleDecision = evaluateRules({ subject: { kind: 'mcp', selector }, rules: input.rules });
    if (ruleDecision === 'deny') {
      decision = 'deny';
      reason = 'mcp-rule-deny';
    } else if (ruleDecision === 'ask') {
      decision = 'ask';
      reason = 'mcp-rule-ask';
    }
    // 'allow' or 'no-match' → allow (enabled server = trusted).
  }

  if (decision === 'ask') {
    if (input.signal?.aborted) {
      throw new Error(`MCP permission aborted for ${selector}`);
    }
    if (input.requestPermission) {
      decision = await input.requestPermission({
        action: 'mcp:tool-call',
        detail: `${target.serverId}/${target.toolName} risk=${target.risk} args=${target.argumentsSummary}`,
        defaultDecision: 'ask',
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } else {
      // Non-interactive: ask degrades to deny.
      decision = 'deny';
    }
  }

  if (decision !== 'allow') {
    throw new Error(`Permission ${decision} for MCP tool ${selector} (${reason})`);
  }

  return target;
}
