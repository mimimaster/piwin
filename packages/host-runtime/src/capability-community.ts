/**
 * Community half of `capability_search` / `capability_install`: skills.sh
 * skills, official-registry MCP servers and Pi packages, searched in parallel
 * and dispatched by entry-id prefix. Each source fails on its own; curated
 * results never depend on any of them.
 */
import type { MarketplaceCapabilityKind, ToolResult } from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import {
  installCommunitySkill,
  searchCommunitySkillEntries,
  type CommunitySkillPorts,
} from './capability-community-skills.js';
import {
  installCommunityMcp,
  searchCommunityMcpEntries,
  type CommunityMcpCache,
  type CommunityMcpPorts,
} from './capability-community-mcp.js';
import {
  installCommunityPackage,
  searchCommunityPackageEntries,
  type CommunityPackagePorts,
} from './capability-community-packages.js';

export type CommunityPorts = CommunitySkillPorts & CommunityMcpPorts & CommunityPackagePorts;

export type CommunityContext = {
  piwinRoot: string;
  agentDirectory: string;
  mcpManager: McpLifecycleManager | null | undefined;
  ports: CommunityPorts;
  /** Registry cards from this tool set's searches; install only accepts these. */
  mcpCache: CommunityMcpCache;
  applyAfterTurn: (label: string) => Promise<ToolResult>;
};

type SourceResult = { entries: Record<string, unknown>[]; error?: string };

/** Community results for `query`, plus one line per source that was unreachable. */
export async function searchCommunity(
  context: CommunityContext,
  input: {
    query: string;
    kind: MarketplaceCapabilityKind | undefined;
    signal: AbortSignal;
    excludeSkillKeys: Set<string>;
  },
): Promise<{ entries: Record<string, unknown>[]; errors: string[] }> {
  const wants = (kind: MarketplaceCapabilityKind) => input.kind === undefined || input.kind === kind;
  const empty: Promise<SourceResult> = Promise.resolve({ entries: [] });
  const [skills, mcp, packages] = await Promise.all([
    wants('skill')
      ? searchCommunitySkillEntries(context.ports, {
          piwinRoot: context.piwinRoot,
          query: input.query,
          signal: input.signal,
          excludeKeys: input.excludeSkillKeys,
        })
      : empty,
    wants('mcp')
      ? searchCommunityMcpEntries(context.ports, {
          piwinRoot: context.piwinRoot,
          query: input.query,
          signal: input.signal,
          cache: context.mcpCache,
        })
      : empty,
    wants('extension')
      ? searchCommunityPackageEntries(context.ports, { query: input.query, signal: input.signal })
      : empty,
  ]);
  const errors = [
    skills.error ? `skills.sh: ${skills.error}` : undefined,
    mcp.error ? `MCP registry: ${mcp.error}` : undefined,
    packages.error ? `Pi packages: ${packages.error}` : undefined,
  ].filter((line): line is string => line !== undefined);
  return { entries: [...skills.entries, ...mcp.entries, ...packages.entries], errors };
}

/** Installs a community entry id; undefined when the id belongs to the curated catalog. */
export async function installCommunity(
  context: CommunityContext,
  entryId: string,
): Promise<ToolResult | undefined> {
  return (
    (await installCommunitySkill(entryId, context.piwinRoot, context.ports)) ??
    (await installCommunityMcp(entryId, {
      piwinRoot: context.piwinRoot,
      mcpManager: context.mcpManager,
      cache: context.mcpCache,
    })) ??
    (await installCommunityPackage(entryId, {
      piwinRoot: context.piwinRoot,
      agentDirectory: context.agentDirectory,
      ports: context.ports,
      applyAfterTurn: context.applyAfterTurn,
    }))
  );
}
