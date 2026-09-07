import { describe, expect, it } from 'vitest';
import type { McpConfigDocument, McpServerConfig, McpToolMetadata } from '@piwin/contracts';
import {
  buildMcpCapabilityBrief,
  MCP_BRIEF_MAX_SELECTOR_CHARS,
  MCP_BRIEF_MAX_SERVERS,
  MCP_BRIEF_MAX_SYSTEM_CHARS,
  MCP_BRIEF_MAX_TOOL_NAME_CHARS,
} from '../mcp-capability-brief.js';
import { MODEL_TOOL_DESCRIPTION_MAX_CHARS } from '../model-tool-descriptor.js';
import { formatCatalogSystemPrompt, formatCatalogToolDescription } from './catalog-brief.js';
import { HOST_TOOLBOX_NAME } from '../host-toolbox.js';

function createConfig(
  mcpServers: Record<string, McpServerConfig>,
  pinnedSelectors?: string[],
): McpConfigDocument {
  const config: McpConfigDocument = { mcpServers };
  if (pinnedSelectors !== undefined) {
    config.pinnedSelectors = [...pinnedSelectors];
  }
  return config;
}

function createTool(serverId: string, toolName: string): McpToolMetadata {
  return {
    serverId,
    toolName,
    selector: `${serverId}.${toolName}`,
    description: `Description for ${toolName}`,
    inputSchema: { type: 'object' },
    metadataFingerprint: 'test-fingerprint',
    fetchedAt: '2026-07-24T00:00:00.000Z',
  };
}

function createLargeBrief() {
  const mcpServers: Record<string, McpServerConfig> = {};
  const cachedToolsByServer: Record<string, readonly McpToolMetadata[]> = {};
  for (let index = 0; index < MCP_BRIEF_MAX_SERVERS; index += 1) {
    const serverId = `server-${index}-${'s'.repeat(100)}`;
    mcpServers[serverId] = { command: 'node' };
    cachedToolsByServer[serverId] = [createTool(serverId, `tool-${index}-${'t'.repeat(100)}`)];
  }
  return buildMcpCapabilityBrief({
    config: createConfig(mcpServers),
    cachedToolsByServer,
  });
}

describe('formatCatalogSystemPrompt', () => {
  it('routes models through piwin_toolbox instead of a separate gateway', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ docs: { command: 'node' } }),
      cachedToolsByServer: {
        docs: [createTool('docs', 'search')],
      },
    });
    const prompt = formatCatalogSystemPrompt(brief);
    expect(prompt).toContain('<mcp_tools>');
    expect(prompt).toContain('## MCP Catalog');
    expect(prompt).toContain(`\`${HOST_TOOLBOX_NAME}\``);
    expect(prompt).toContain('`docs`: 1 cached tool(s)');
    expect(prompt).not.toContain('mcp_gateway');
  });

  it('returns undefined when no servers are enabled', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ disabled: { command: 'node', disabled: true } }),
      cachedToolsByServer: {},
    });
    expect(formatCatalogSystemPrompt(brief)).toBeUndefined();
  });

  it('reports omitted servers and stays within the system prompt cap', () => {
    const omittedServerCount = 3;
    const mcpServers: Record<string, McpServerConfig> = {};
    const cachedToolsByServer: Record<string, readonly McpToolMetadata[]> = {};
    for (let index = 0; index < MCP_BRIEF_MAX_SERVERS + omittedServerCount; index += 1) {
      const serverId = `server-${index}`;
      mcpServers[serverId] = { command: 'node' };
      cachedToolsByServer[serverId] = [createTool(serverId, 'search')];
    }
    const brief = buildMcpCapabilityBrief({
      config: createConfig(mcpServers),
      cachedToolsByServer,
    });
    const prompt = formatCatalogSystemPrompt(brief);
    expect(prompt).toContain(
      `${omittedServerCount} additional configured server(s) omitted from this bounded list`,
    );
    expect(prompt?.length).toBeLessThanOrEqual(MCP_BRIEF_MAX_SYSTEM_CHARS);
  });

  it('truncates an oversized inventory to the hard character cap', () => {
    const prompt = formatCatalogSystemPrompt(createLargeBrief());
    expect(prompt).toHaveLength(MCP_BRIEF_MAX_SYSTEM_CHARS);
    expect(prompt?.endsWith('…')).toBe(true);
  });
});

describe('formatCatalogToolDescription', () => {
  it('identifies browser targets as the shared right sidebar and gives the call order', () => {
    const description = formatCatalogToolDescription([
      'browser_back',
      'browser_fill_form',
      'browser_find',
      'browser_snapshot',
      'browser_click',
      'browser_forward',
      'browser_lock',
      'browser_navigate',
      'browser_press_key',
      'browser_reload',
      'browser_restart',
      'browser_screenshot',
      'browser_scroll',
      'browser_status',
      'browser_type',
      'browser_viewport',
      'browser_wait',
      'browser_wait_for',
      'browser_hover',
      'browser_tabs',
      'process_start',
      'image_gen',
    ]);
    expect(description).toContain('Right sidebar Browser');
    expect(description).toContain('First describe(target), then call(target, arguments)');
    expect(description).toContain('find uses text');
    expect(description.length).toBeLessThanOrEqual(MODEL_TOOL_DESCRIPTION_MAX_CHARS);
  });

  it('lists Host targets and MCP inventory in the model-visible budget', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ docs: { command: 'node' } }),
      cachedToolsByServer: {
        docs: [createTool('docs', 'search')],
      },
      directExposedNames: ['mcp__docs__search'],
    });
    const description = formatCatalogToolDescription(['flashcard_create', 'image_gen'], brief);
    expect(description).toContain('Host targets: flashcard_create, image_gen');
    expect(description).toContain('docs(1)');
    expect(description).toContain('e.g. docs.search');
    expect(description).toContain('Pinned: mcp__docs__search');
    expect(description.length).toBeLessThanOrEqual(MODEL_TOOL_DESCRIPTION_MAX_CHARS);
  });

  it('uses exact selectors rather than truncated tool names', () => {
    const toolName = `tool-${'x'.repeat(MCP_BRIEF_MAX_TOOL_NAME_CHARS + 10)}`;
    const selector = `server.${toolName}`;
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ server: { command: 'node' } }),
      cachedToolsByServer: { server: [createTool('server', toolName)] },
    });
    const description = formatCatalogToolDescription([], brief);
    expect(description).toContain(`e.g. ${selector}`);
    expect(description).not.toContain(
      `e.g. server.${toolName.slice(0, MCP_BRIEF_MAX_TOOL_NAME_CHARS - 1)}…`,
    );
  });

  it('skips over-budget selectors and keeps a later short example', () => {
    const longToolName = 'l'.repeat(MCP_BRIEF_MAX_SELECTOR_CHARS);
    const brief = buildMcpCapabilityBrief({
      config: createConfig({
        long: { command: 'node' },
        short: { command: 'node' },
      }),
      cachedToolsByServer: {
        long: [createTool('long', longToolName)],
        short: [createTool('short', 'tool')],
      },
    });
    const description = formatCatalogToolDescription([], brief);
    expect(description).toContain('short.tool');
    expect(description).not.toContain(`long.${longToolName}`);
  });

  it('notes when no MCP servers are enabled', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ disabled: { command: 'node', disabled: true } }),
      cachedToolsByServer: {},
    });
    const description = formatCatalogToolDescription(['image_gen'], brief);
    expect(description).toContain('Host targets: image_gen');
    expect(description).toContain('No MCP servers are enabled in this generation.');
  });
});
