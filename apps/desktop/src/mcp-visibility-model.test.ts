import { describe, expect, it } from 'vitest';
import {
  buildMcpToolCatalogEntries,
  getMcpConnectionFailure,
  listMcpSchemaProperties,
  resolveMcpServerRuntimeUiStatus,
} from './mcp-visibility-model.js';

describe('mcp visibility model', () => {
  it('marks pinned tools direct and synthesizes dormant pins', () => {
    const entries = buildMcpToolCatalogEntries({
      serverId: 'agent-memory',
      tools: [
        {
          serverId: 'agent-memory',
          name: 'agent_memory_search',
          exposedName: 'mcp__agent-memory__agent_memory_search',
          description: 'Search memories',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Natural language query' },
              project: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ],
      pinnedSelectors: [
        'agent-memory.agent_memory_search',
        'agent-memory.agent_memory_remember',
      ],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: 'agent_memory_search',
      exposure: 'direct',
      source: 'live',
    });
    expect(entries[1]).toMatchObject({
      name: 'agent_memory_remember',
      exposure: 'dormant-pin',
      source: 'pinned-dormant',
    });
  });

  it('flattens JSON Schema properties for the catalog table', () => {
    const rows = listMcpSchemaProperties({
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search text' },
        top_k: { type: 'integer', description: 'Limit' },
      },
    });
    expect(rows).toEqual([
      {
        name: 'query',
        typeLabel: 'string',
        required: true,
        description: 'Search text',
      },
      {
        name: 'top_k',
        typeLabel: 'integer',
        required: false,
        description: 'Limit',
      },
    ]);
  });

  it('maps health into a coarse list status', () => {
    expect(
      resolveMcpServerRuntimeUiStatus({
        enabled: true,
        health: {
          serverId: 'playwright',
          status: 'running',
          command: 'npx',
          disabled: false,
          toolCount: 22,
          pid: 1234,
        },
      }),
    ).toBe('running');
    expect(
      resolveMcpServerRuntimeUiStatus({
        enabled: false,
        health: {
          serverId: 'playwright',
          status: 'running',
          command: 'npx',
          disabled: true,
          toolCount: 0,
        },
      }),
    ).toBe('stopped');
  });

  it('reports a failed start even when the Host returned a successful response envelope', () => {
    const health = {
      serverId: 'cloudflare',
      status: 'error' as const,
      command: 'npx',
      disabled: false,
      toolCount: 0,
      lastError: 'MCP connect timeout',
    };
    expect(getMcpConnectionFailure(health, true)).toBe('MCP connect timeout');
    expect(
      getMcpConnectionFailure(
        {
          serverId: 'cloudflare',
          status: 'running',
          command: 'npx',
          disabled: false,
          toolCount: 2,
        },
        true,
      ),
    ).toBeNull();
    expect(getMcpConnectionFailure(undefined, true)).toBe('连接失败。');
  });
});
