import type { McpToolCallTarget, PermissionDecision } from '@piwin/contracts';
import {
  evaluateMcpToolCallRisk,
  redactMcpArgumentsSummary,
  resolveNonInteractiveDecision,
} from './permission-policy.js';
import type { ToolPermissionGate } from './session-tools.js';

export type McpCallPermissionInput = {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestPermission?: ToolPermissionGate;
  signal?: AbortSignal;
};

/**
 * Shared MCP tool-call gate for direct tools and mcp_gateway call.
 * Builds structured permission detail + risk evaluation.
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

  let decision: PermissionDecision = evaluation.decision;
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
      decision = resolveNonInteractiveDecision(evaluation);
    }
  }

  if (decision !== 'allow') {
    throw new Error(
      `Permission ${decision} for MCP tool ${selector} (${evaluation.reason})`,
    );
  }

  return target;
}
