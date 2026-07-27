/** CE-HUB: MCP registry cards + skill store entries (no private central server). */

import type { McpServerConfig } from './mcp.js';
import type { InstallSource } from './mcp.js';

export type McpRegistrySourceId = 'official' | 'smithery' | 'glama' | 'static';

export type McpRegistryCard = {
  id: string;
  title: string;
  description: string;
  source: McpRegistrySourceId;
  homepage?: string;
  /** Ready-to-save server config when known. */
  installDraft?: McpServerConfig;
  /** Partial draft requiring user edits. */
  manualDraft?: Partial<McpServerConfig> & { id?: string };
  /** When true, server needs non-stdio transport not fully supported yet. */
  requiresSse?: boolean;
};

export type SkillStoreEntry = {
  id: string;
  name: string;
  description: string;
  source: InstallSource;
};

export type MarketplaceConfig = {
  skillSources?: Array<'static' | 'git-index'>;
  mcpRegistrySources?: McpRegistrySourceId[];
};

export function createDefaultMarketplaceConfig(): MarketplaceConfig {
  return {
    skillSources: ['static'],
    mcpRegistrySources: ['static'],
  };
}
