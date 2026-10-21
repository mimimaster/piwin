/**
 * CE-HUB-MCP: static + optional remote registry cards.
 * Official/Smithery network fetch is best-effort; static fixture always works offline.
 */
import type { McpRegistryCard, McpServerConfig } from '@piwin/contracts';
import { MCP_CATALOG } from './catalog/mcp.js';
import { searchOfficialMcpRegistry } from './mcp-official-registry.js';

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
 * Static cards plus the official registry's matches. Never throws: a slow or
 * offline registry leaves the curated cards. Callers that must report the
 * failure use `searchOfficialMcpRegistry` directly.
 */
export async function listMcpRegistryCards(options?: {
  query?: string;
  includeOfficial?: boolean;
  /** Injected transport so callers/tests never reach the network by accident. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<McpRegistryCard[]> {
  const staticCards = listStaticMcpRegistry(options?.query);
  if (!options?.includeOfficial) {
    return staticCards;
  }
  try {
    const remote = await searchOfficialMcpRegistry({
      query: options.query ?? '',
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    // Curated drafts first; a registry copy of the same server id is dropped.
    const seen = new Set(staticCards.map((card) => card.id));
    return [...staticCards, ...remote.filter((card) => !seen.has(card.id))];
  } catch {
    // Offline or slow registry: the curated cards still work.
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
