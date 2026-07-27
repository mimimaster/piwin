import type {
  McpMetadataDocument,
  McpServerConfig,
  McpToolMetadata,
} from '@piwin/contracts';
import { fingerprintMcpServerConfig, formatMcpToolSelector, parseMcpToolSelector } from './mcp-fingerprint.js';
import {
  createEmptyMcpMetadataDocument,
  loadMcpMetadataDocument,
  saveMcpMetadataDocument,
} from './mcp-metadata-store.js';
import type { McpListedTool } from './mcp-transport.js';

export type McpMetadataCatalog = {
  load: () => Promise<McpMetadataDocument>;
  searchCached: (query: string, options?: {
    serverId?: string;
    limit?: number;
  }) => Promise<McpToolMetadata[]>;
  describeCached: (selector: string) => Promise<McpToolMetadata | null>;
  listCachedForServer: (serverId: string) => Promise<McpToolMetadata[]>;
  isServerCacheValid: (serverId: string, config: McpServerConfig) => Promise<boolean>;
  replaceServerMetadata: (
    serverId: string,
    config: McpServerConfig,
    tools: McpListedTool[],
  ) => Promise<McpToolMetadata[]>;
  markServerStale: (serverId: string) => Promise<void>;
  getAllCachedTools: () => Promise<McpToolMetadata[]>;
};

export function createMcpMetadataCatalog(piwinRoot: string): McpMetadataCatalog {
  let documentPromise: Promise<McpMetadataDocument> | null = null;

  async function loadDocument(): Promise<McpMetadataDocument> {
    if (!documentPromise) {
      documentPromise = loadMcpMetadataDocument(piwinRoot).catch((error) => {
        documentPromise = null;
        throw error;
      });
    }
    return documentPromise;
  }

  async function persist(document: McpMetadataDocument): Promise<void> {
    await saveMcpMetadataDocument(piwinRoot, document);
    documentPromise = Promise.resolve(document);
  }

  return {
    async load() {
      return loadDocument();
    },

    async searchCached(query, options = {}) {
      const document = await loadDocument();
      const normalizedQuery = query.trim().toLowerCase();
      const limit = options.limit ?? 20;
      const results: McpToolMetadata[] = [];

      for (const [serverId, entry] of Object.entries(document.servers)) {
        if (options.serverId && options.serverId !== serverId) {
          continue;
        }
        if (entry.stale) {
          continue;
        }
        for (const tool of entry.tools) {
          if (!normalizedQuery) {
            results.push(tool);
          } else {
            const haystack = `${tool.selector} ${tool.description} ${tool.toolName}`.toLowerCase();
            if (haystack.includes(normalizedQuery)) {
              results.push(tool);
            }
          }
          if (results.length >= limit) {
            return results;
          }
        }
      }
      return results;
    },

    async describeCached(selector) {
      const parsed = parseMcpToolSelector(selector);
      if (!parsed) {
        return null;
      }
      const document = await loadDocument();
      const entry = document.servers[parsed.serverId];
      if (!entry || entry.stale) {
        return null;
      }
      return (
        entry.tools.find(
          (tool) =>
            tool.selector === selector || tool.toolName === parsed.toolName,
        ) ?? null
      );
    },

    async listCachedForServer(serverId) {
      const document = await loadDocument();
      const entry = document.servers[serverId];
      if (!entry || entry.stale) {
        return [];
      }
      return [...entry.tools];
    },

    async isServerCacheValid(serverId, config) {
      const document = await loadDocument();
      const entry = document.servers[serverId];
      if (!entry || entry.stale) {
        return false;
      }
      return entry.metadataFingerprint === fingerprintMcpServerConfig(serverId, config);
    },

    async replaceServerMetadata(serverId, config, tools) {
      const document = await loadDocument();
      const fingerprint = fingerprintMcpServerConfig(serverId, config);
      const fetchedAt = new Date().toISOString();
      const metadataTools: McpToolMetadata[] = tools
        .filter((tool) => typeof tool.name === 'string' && tool.name.trim().length > 0)
        .map((tool) => ({
          serverId,
          toolName: tool.name,
          selector: formatMcpToolSelector(serverId, tool.name),
          description: tool.description?.trim() || '',
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? tool.inputSchema
              : { type: 'object', additionalProperties: true },
          metadataFingerprint: fingerprint,
          fetchedAt,
        }));

      document.servers[serverId] = {
        metadataFingerprint: fingerprint,
        tools: metadataTools,
        updatedAt: fetchedAt,
        stale: false,
      };
      await persist(document);
      return metadataTools;
    },

    async markServerStale(serverId) {
      const document = await loadDocument();
      const entry = document.servers[serverId];
      if (!entry) {
        return;
      }
      entry.stale = true;
      await persist(document);
    },

    async getAllCachedTools() {
      const document = await loadDocument();
      const tools: McpToolMetadata[] = [];
      for (const entry of Object.values(document.servers)) {
        if (entry.stale) {
          continue;
        }
        tools.push(...entry.tools);
      }
      return tools;
    },
  };
}

/** Pure helper for tests: empty document factory. */
export function emptyMetadataDocument(): McpMetadataDocument {
  return createEmptyMcpMetadataDocument();
}
