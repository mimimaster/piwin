/**
 * Community MCP servers from the official MCP registry for the agent's
 * capability tools. Install takes only servers the same tool set returned from
 * a search (cached by entry id), so the saved command is always the
 * registry's own package draft, never one the model composed.
 */
import type { McpRegistryCard, ToolResult } from '@piwin/contracts';
import {
  describeMcpServerEndpoint,
  describeMcpServerLaunch,
  formatError,
  isRemoteMcpServerConfig,
} from '@piwin/contracts';
import { officialMcpServerId } from '@piwin/marketplace';
import type { McpLifecycleManager } from '@piwin/mcp';
import { connectMcpDraft } from './capability-mcp-connect.js';

const ENTRY_PREFIX = 'mcp-registry:';
/** Enough to pick from without flooding the transcript. */
export const COMMUNITY_MCP_SEARCH_LIMIT = 8;

export type CommunityMcpPorts = {
  searchCommunityMcp: (input: { query: string; signal: AbortSignal }) => Promise<McpRegistryCard[]>;
  listMcpServerIds: (piwinRoot: string) => Promise<Set<string>>;
};

export type CommunityMcpCache = Map<string, McpRegistryCard>;

function registryName(card: McpRegistryCard): string {
  return card.id.replace(/^official:/, '');
}

export function communityMcpEntryId(card: McpRegistryCard): string {
  return `${ENTRY_PREFIX}${registryName(card)}`;
}

function describeCard(card: McpRegistryCard, configured: Set<string>): Record<string, unknown> {
  const draft = card.installDraft;
  return {
    entryId: communityMcpEntryId(card),
    kind: 'mcp',
    name: card.title,
    summary: card.description,
    curated: false,
    source: 'official MCP registry (not reviewed by piwin)',
    ...(card.repositoryUrl ? { repository: card.repositoryUrl } : {}),
    runnable: Boolean(draft),
    ...(draft ? { command: describeMcpServerLaunch(draft) } : {}),
    ...(card.requiredEnv?.length ? { requiredEnv: card.requiredEnv } : {}),
    ...(draft
      ? {}
      : { note: 'Remote endpoint that needs an API key header; the user adds it in Settings → MCP.' }),
    installed: configured.has(officialMcpServerId(registryName(card))),
  };
}

export async function searchCommunityMcpEntries(
  ports: CommunityMcpPorts,
  input: { piwinRoot: string; query: string; signal: AbortSignal; cache: CommunityMcpCache },
): Promise<{ entries: Record<string, unknown>[]; error?: string }> {
  try {
    const [cards, configured] = await Promise.all([
      ports.searchCommunityMcp({ query: input.query, signal: input.signal }),
      ports.listMcpServerIds(input.piwinRoot),
    ]);
    const shown = cards.slice(0, COMMUNITY_MCP_SEARCH_LIMIT);
    for (const card of shown) input.cache.set(communityMcpEntryId(card), card);
    return { entries: shown.map((card) => describeCard(card, configured)) };
  } catch (error) {
    return { entries: [], error: formatError(error) };
  }
}

/** Installs a cached `mcp-registry:` entry; undefined when the id is not one. */
export async function installCommunityMcp(
  entryId: string,
  input: {
    piwinRoot: string;
    mcpManager: McpLifecycleManager | null | undefined;
    cache: CommunityMcpCache;
  },
): Promise<ToolResult | undefined> {
  if (!entryId.startsWith(ENTRY_PREFIX)) return undefined;
  const card = input.cache.get(entryId);
  if (!card) {
    return {
      ok: false,
      code: 'invalid-input',
      message: `Unknown MCP registry entry "${entryId}". Call capability_search with kind "mcp" first.`,
    };
  }
  if (!card.installDraft) {
    return {
      ok: false,
      code: 'invalid-input',
      message: `"${card.title}" is a remote endpoint that needs an API key header; ask the user to add it in Settings → MCP.`,
    };
  }
  try {
    return await connectMcpDraft({
      piwinRoot: input.piwinRoot,
      mcpManager: input.mcpManager,
      entryId,
      serverId: officialMcpServerId(registryName(card)),
      draft: card.installDraft,
      ...(card.requiredEnv ? { requiredEnv: card.requiredEnv } : {}),
      prerequisites: [
        isRemoteMcpServerConfig(card.installDraft)
          ? `network access to ${describeMcpServerEndpoint(card.installDraft)}`
          : card.installDraft.command,
      ],
    });
  } catch (error) {
    return { ok: false, code: 'execution-failed', message: `Installing "${entryId}" failed: ${formatError(error)}` };
  }
}
