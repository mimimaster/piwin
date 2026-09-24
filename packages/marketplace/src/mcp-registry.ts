/**
 * CE-HUB-MCP: static + optional remote registry cards.
 * Official/Smithery network fetch is best-effort; static fixture always works offline.
 */
import type { McpRegistryCard, McpServerConfig } from '@piwin/contracts';
import { MCP_CATALOG } from './catalog/mcp.js';

/** Offline-friendly recommended MCP servers, projected from the curated catalog. */
export const STATIC_MCP_REGISTRY: McpRegistryCard[] = MCP_CATALOG.flatMap((entry) =>
  entry.install.kind === 'mcp'
    ? [
        {
          id: entry.install.serverId,
          title: entry.name.en,
          description: entry.summary.en,
          source: 'static' as const,
          ...(entry.homepage ? { homepage: entry.homepage } : {}),
          installDraft: entry.install.draft,
        },
      ]
    : [],
);

export function listStaticMcpRegistry(query?: string): McpRegistryCard[] {
  const q = query?.trim().toLowerCase() ?? '';
  if (!q) return STATIC_MCP_REGISTRY;
  return STATIC_MCP_REGISTRY.filter(
    (card) =>
      card.id.toLowerCase().includes(q) ||
      card.title.toLowerCase().includes(q) ||
      card.description.toLowerCase().includes(q),
  );
}

/**
 * Best-effort official registry fetch. Falls back to static on any failure.
 * Does not throw.
 */
export async function listMcpRegistryCards(options?: {
  query?: string;
  includeOfficial?: boolean;
}): Promise<McpRegistryCard[]> {
  const staticCards = listStaticMcpRegistry(options?.query);
  if (!options?.includeOfficial) {
    return staticCards;
  }
  try {
    const url = 'https://registry.modelcontextprotocol.io/v0/servers?limit=30';
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return staticCards;
    const payload = (await response.json()) as {
      servers?: Array<{ name?: string; description?: string; packages?: unknown[] }>;
    };
    const remote: McpRegistryCard[] = [];
    for (const server of payload.servers ?? []) {
      const name = server.name?.trim();
      if (!name) continue;
      remote.push({
        id: `official:${name}`,
        title: name,
        description: server.description?.trim() || 'Official MCP registry entry',
        source: 'official',
        manualDraft: {
          command: 'npx',
          args: ['-y', name],
        },
      });
    }
    const q = options.query?.trim().toLowerCase() ?? '';
    const filtered = q
      ? remote.filter(
          (card) =>
            card.title.toLowerCase().includes(q) ||
            card.description.toLowerCase().includes(q),
        )
      : remote;
    // Prefer static drafts first, then remote
    const seen = new Set(staticCards.map((card) => card.id));
    return [...staticCards, ...filtered.filter((card) => !seen.has(card.id))];
  } catch {
    return staticCards;
  }
}

export function draftToServerConfig(
  serverId: string,
  draft: McpServerConfig,
): { serverId: string; config: McpServerConfig } {
  const id = serverId.trim().replace(/[^a-zA-Z0-9._-]/g, '-') || 'mcp-server';
  return { serverId: id, config: draft };
}
