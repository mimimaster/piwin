/**
 * Save an MCP draft and bring it up, shared by curated and community
 * `capability_install` paths. A server with required env vars is saved with
 * empty placeholders and not started: starting it would only fail, and secret
 * values belong in Settings → MCP, not in the chat transcript.
 */
import type { McpServerConfig, ToolResult } from '@piwin/contracts';
import { withMcpEnvPlaceholders } from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import { saveMcpServerDraft, startMcpServerWithDiscovery } from './marketplace/mcp-install.js';

export type ConnectMcpDraftInput = {
  piwinRoot: string;
  mcpManager: McpLifecycleManager | null | undefined;
  entryId: string;
  serverId: string;
  draft: McpServerConfig;
  requiredEnv?: readonly string[];
  /** Human-readable prerequisites, quoted back when the server fails to start. */
  prerequisites: readonly string[];
};

export async function connectMcpDraft(input: ConnectMcpDraftInput): Promise<ToolResult> {
  if (!input.mcpManager) {
    return {
      ok: false,
      code: 'execution-failed',
      message: 'MCP is not available on this Host; the user can add it from Settings → MCP.',
    };
  }
  const requiredEnv = input.requiredEnv ?? [];
  const saved = await saveMcpServerDraft(
    input.piwinRoot,
    input.mcpManager,
    input.serverId,
    withMcpEnvPlaceholders(input.draft, requiredEnv),
  );
  if (requiredEnv.length > 0) {
    return {
      ok: true,
      output:
        `Saved MCP server "${saved.serverId}" without starting it: it needs ${requiredEnv.join(', ')}. ` +
        'Ask the user to fill these in Settings → MCP and start it there; do not ask for secret values in chat.',
      details: { entryId: input.entryId, serverId: saved.serverId, needsEnv: [...requiredEnv] },
    };
  }
  const health = await startMcpServerWithDiscovery(input.mcpManager, saved.serverId);
  if (health.status !== 'running' || health.lastError) {
    return {
      ok: false,
      code: 'execution-failed',
      message:
        `Saved MCP server "${saved.serverId}" but it did not start: ${health.lastError ?? health.status}. ` +
        `Check the prerequisites (${input.prerequisites.join(', ') || 'none'}).`,
    };
  }
  return {
    ok: true,
    output: `Connected MCP server "${saved.serverId}" (${health.toolCount} tools). New sessions expose its tools.`,
    details: { entryId: input.entryId, serverId: saved.serverId, toolCount: health.toolCount },
  };
}
