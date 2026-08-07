import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpConfigDocument, McpServerConfig, McpToolMetadata } from '@piwin/contracts';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { buildMcpGatewayToolDefinition } from './mcp-gateway-tool.js';
import { buildSessionHostTools } from './tools/build-session-host-tools.js';
import {
  buildMcpCapabilityBrief,
  formatMcpCapabilitySystemPrompt,
  formatMcpGatewayToolDescription,
  MCP_BRIEF_MAX_DESCRIPTION_CHARS,
  MCP_BRIEF_MAX_SELECTOR_CHARS,
  MCP_BRIEF_MAX_SERVERS,
  MCP_BRIEF_MAX_SYSTEM_CHARS,
  MCP_BRIEF_MAX_TOOL_NAME_CHARS,
  MCP_BRIEF_MAX_TOOLS_PER_SERVER,
} from './mcp-capability-brief.js';

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

describe('buildMcpCapabilityBrief', () => {
  it('uses a supplied gateway description while retaining the default', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-gateway-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    try {
      const customDescription = 'MCP capability brief descriptor';
      const customGateway = buildMcpGatewayToolDefinition({
        lifecycleManager,
        description: customDescription,
      });
      const defaultGateway = buildMcpGatewayToolDefinition({ lifecycleManager });

      expect(customGateway.descriptor.description).toBe(customDescription);
      expect(defaultGateway.descriptor.description).toContain(
        'Discover and call MCP tools through a single gateway.',
      );
    } finally {
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps the gateway and emits a config-only brief when cache reading fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-compose-'));
    const metadataPath = join(rootDir, 'mcp-metadata.json');
    await writeFile(metadataPath, '{not valid json', 'utf8');
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    try {
      let callbackCount = 0;
      let receivedBrief: ReturnType<typeof buildMcpCapabilityBrief> | undefined;
      const diagnostics: string[] = [];
      const tools = await buildSessionHostTools({
        sessionId: 'session-test',
        piwinRoot: rootDir,
        mcpManager: lifecycleManager,
        mcpConfig: createConfig({ docs: { command: 'node' } }),
        onDiagnostic: ({ capability, message }) => {
          if (capability === 'mcp-cached-tools') {
            diagnostics.push(message);
          }
        },
        onMcpCapabilityBrief: (brief) => {
          callbackCount += 1;
          receivedBrief = brief;
        },
      });

      const gateway = tools.find((tool) => tool.descriptor.name === 'mcp_gateway');
      expect(gateway?.descriptor.description).toContain('docs(uncached)');
      expect(callbackCount).toBe(1);
      expect(receivedBrief).toMatchObject({
        enabledServerCount: 1,
        cachedToolCount: 0,
        uncachedServerIds: ['docs'],
        directExposedNames: [],
      });
      expect(diagnostics).toHaveLength(1);
    } finally {
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('includes enabled servers while excluding disabled servers and summarizes cached tools', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({
        active: { command: 'node' },
        disabled: { command: 'node', disabled: true },
        empty: { command: 'node' },
      }),
      cachedToolsByServer: {
        active: [createTool('active', 'search'), createTool('active', 'write')],
        disabled: [createTool('disabled', 'hidden')],
      },
    });

    expect(brief.enabledServerCount).toBe(2);
    expect(brief.cachedToolCount).toBe(2);
    expect(brief.uncachedServerIds).toEqual(['empty']);
    expect(brief.servers).toEqual([
      {
        serverId: 'active',
        cached: true,
        toolCount: 2,
        sampleToolNames: ['search', 'write'],
        sampleToolSelectors: ['active.search', 'active.write'],
      },
      {
        serverId: 'empty',
        cached: false,
        toolCount: 0,
        sampleToolNames: [],
        sampleToolSelectors: [],
      },
    ]);
  });

  it('derives exposed direct tool names from pinned selectors', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ github: { command: 'node' } }, ['github.list_repos', 'memory.store']),
      cachedToolsByServer: {},
    });

    expect(brief.pinnedSelectors).toEqual(['github.list_repos', 'memory.store']);
    expect(brief.directExposedNames).toEqual(['mcp__github__list_repos', 'mcp__memory__store']);
  });

  it('uses explicit direct exposed names instead of deriving names from pins', () => {
    const explicitNames = ['mcp__github__list_repos', 'mcp__custom__lookup'];
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ github: { command: 'node' } }, ['github.other_tool']),
      cachedToolsByServer: {},
      directExposedNames: explicitNames,
    });

    expect(brief.directExposedNames).toEqual(explicitNames);
  });

  it('uses exact selectors in gateway examples when tool names are truncated', () => {
    const toolName = `tool-${'x'.repeat(MCP_BRIEF_MAX_TOOL_NAME_CHARS + 10)}`;
    const selector = `server.${toolName}`;
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ server: { command: 'node' } }),
      cachedToolsByServer: {
        server: [createTool('server', toolName)],
      },
    });

    const truncatedToolName = `${toolName.slice(0, MCP_BRIEF_MAX_TOOL_NAME_CHARS - 1)}…`;
    expect(brief.servers[0]?.sampleToolNames).toEqual([truncatedToolName]);
    expect(brief.servers[0]?.sampleToolSelectors).toEqual([selector]);

    const description = formatMcpGatewayToolDescription(brief);
    expect(description).toContain(`Example selectors: ${selector}.`);
    expect(description).not.toContain(`Example selectors: server.${truncatedToolName}.`);
  });

  it('skips an over-budget selector and still considers later shorter examples', () => {
    const mcpServers: Record<string, McpServerConfig> = {};
    const paddingServerCount = 19;
    for (let index = 0; index < paddingServerCount; index += 1) {
      mcpServers[`padding-${'p'.repeat(80)}-${index}`] = { command: 'node' };
    }
    mcpServers.long = { command: 'node' };
    mcpServers.short = { command: 'node' };

    const longToolName = 'l'.repeat(MCP_BRIEF_MAX_SELECTOR_CHARS - 'long.'.length);
    const longSelector = `long.${longToolName}`;
    const shortSelector = 'short.tool';
    expect(longSelector).toHaveLength(MCP_BRIEF_MAX_SELECTOR_CHARS);

    const brief = buildMcpCapabilityBrief({
      config: createConfig(mcpServers),
      cachedToolsByServer: {
        long: [createTool('long', longToolName)],
        short: [createTool('short', 'tool')],
      },
    });

    const description = formatMcpGatewayToolDescription(brief);
    expect(description).toContain(`Example selectors: ${shortSelector}.`);
    expect(description).not.toContain(longSelector);
    expect(description).not.toContain(
      `${longSelector.slice(0, MCP_BRIEF_MAX_SELECTOR_CHARS - 1)}…`,
    );
  });

  it('omits selectors above the selector cap from gateway examples', () => {
    const toolName = `tool-${'x'.repeat(MCP_BRIEF_MAX_SELECTOR_CHARS)}`;
    const selector = `server.${toolName}`;
    const brief = buildMcpCapabilityBrief({
      config: createConfig({ server: { command: 'node' } }),
      cachedToolsByServer: {
        server: [createTool('server', toolName)],
      },
    });

    const truncatedSelector = `${selector.slice(0, MCP_BRIEF_MAX_SELECTOR_CHARS - 1)}…`;
    expect(brief.servers[0]?.sampleToolNames).toEqual([
      `${toolName.slice(0, MCP_BRIEF_MAX_TOOL_NAME_CHARS - 1)}…`,
    ]);
    expect(brief.servers[0]?.sampleToolSelectors).toEqual([selector]);

    const description = formatMcpGatewayToolDescription(brief);
    expect(description).not.toContain('Example selectors:');
    expect(description).not.toContain(truncatedSelector);
  });

  it('caps listed servers and reports omitted servers separately', () => {
    const omittedServerCount = 3;
    const totalServerCount = MCP_BRIEF_MAX_SERVERS + omittedServerCount;
    const firstServerToolCount = MCP_BRIEF_MAX_TOOLS_PER_SERVER + 2;
    const mcpServers: Record<string, McpServerConfig> = {};
    const cachedToolsByServer: Record<string, readonly McpToolMetadata[]> = {};

    for (let index = 0; index < totalServerCount; index += 1) {
      const serverId = `server-${index}`;
      mcpServers[serverId] = { command: 'node' };
      const toolCount = index === 0 ? firstServerToolCount : 1;
      cachedToolsByServer[serverId] = Array.from({ length: toolCount }, (_, toolIndex) =>
        createTool(serverId, `tool-${toolIndex}-${'x'.repeat(MCP_BRIEF_MAX_TOOL_NAME_CHARS + 10)}`),
      );
    }

    const brief = buildMcpCapabilityBrief({
      config: createConfig(mcpServers),
      cachedToolsByServer,
    });

    expect(brief.enabledServerCount).toBe(totalServerCount);
    expect(brief.cachedToolCount).toBe(firstServerToolCount + totalServerCount - 1);
    expect(brief.omittedServerCount).toBe(omittedServerCount);
    expect(brief.uncachedServerIds).toEqual([]);
    expect(brief.servers).toHaveLength(MCP_BRIEF_MAX_SERVERS);
    expect(brief.servers.map((server) => server.serverId)).toEqual(
      Array.from({ length: MCP_BRIEF_MAX_SERVERS }, (_, index) => `server-${index}`),
    );
    expect(brief.servers[0]?.toolCount).toBe(firstServerToolCount);
    expect(brief.servers[0]?.sampleToolNames).toHaveLength(MCP_BRIEF_MAX_TOOLS_PER_SERVER);
    expect(
      brief.servers[0]?.sampleToolNames.every(
        (name) => name.length <= MCP_BRIEF_MAX_TOOL_NAME_CHARS,
      ),
    ).toBe(true);
    expect(brief.servers[0]?.sampleToolNames[0]?.endsWith('…')).toBe(true);

    const systemPrompt = formatMcpCapabilitySystemPrompt(brief);
    expect(systemPrompt).toContain(
      `Configured server list truncated: ${omittedServerCount} more configured server(s) omitted from this bounded list.`,
    );
    expect(systemPrompt).not.toContain(`…(+${omittedServerCount} more servers)`);

    const description = formatMcpGatewayToolDescription(brief);
    expect(description).toContain(
      `Configured server list truncated: ${omittedServerCount} more configured server(s) omitted from this bounded summary.`,
    );
    expect(description).not.toContain('Uncached/empty metadata:');
  });

  it('keeps the system prompt within its hard character cap', () => {
    const systemPrompt = formatMcpCapabilitySystemPrompt(createLargeBrief());

    expect(systemPrompt).toHaveLength(MCP_BRIEF_MAX_SYSTEM_CHARS);
    expect(systemPrompt.length).toBeLessThanOrEqual(MCP_BRIEF_MAX_SYSTEM_CHARS);
    expect(systemPrompt.endsWith('…')).toBe(true);
  });

  it('keeps the gateway description within its hard character cap', () => {
    const description = formatMcpGatewayToolDescription(createLargeBrief());

    expect(description).toHaveLength(MCP_BRIEF_MAX_DESCRIPTION_CHARS);
    expect(description.length).toBeLessThanOrEqual(MCP_BRIEF_MAX_DESCRIPTION_CHARS);
    expect(description.endsWith('…')).toBe(true);
  });

  it('describes a generation with no enabled servers without cached capabilities', () => {
    const brief = buildMcpCapabilityBrief({
      config: createConfig({
        disabled: { command: 'node', disabled: true },
      }),
      cachedToolsByServer: {
        disabled: [createTool('disabled', 'hidden')],
      },
    });

    expect(brief).toEqual({
      enabledServerCount: 0,
      cachedToolCount: 0,
      uncachedServerIds: [],
      omittedServerCount: 0,
      servers: [],
      pinnedSelectors: [],
      directExposedNames: [],
    });
    expect(formatMcpCapabilitySystemPrompt(brief)).toBe(
      [
        '## MCP tools',
        'No MCP servers are enabled in this session generation.',
        'If the user configures MCP later, a new generation rebuilds this surface.',
      ].join('\n'),
    );

    const description = formatMcpGatewayToolDescription(brief);
    expect(description).toContain(
      'Enabled servers (0): No enabled MCP servers in this generation.',
    );
    expect(description).toContain('Cached tools visible to search: 0.');
    expect(description).not.toContain('..');
  });
});
