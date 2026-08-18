import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpConfigDocument, McpServerConfig, McpToolMetadata } from '@piwin/contracts';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { HOST_TOOLBOX_NAME } from './host-toolbox.js';
import { buildSessionHostTools } from './tools/build-session-host-tools.js';
import {
  buildMcpCapabilityBrief,
  MCP_BRIEF_MAX_SERVERS,
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

describe('buildMcpCapabilityBrief', () => {
  it('keeps the catalog shell and emits a config-only brief when cache reading fails', async () => {
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

      const toolbox = tools.find((tool) => tool.descriptor.name === HOST_TOOLBOX_NAME);
      expect(toolbox?.descriptor.description).toContain('docs(uncached)');
      expect(tools.some((tool) => tool.descriptor.name === 'mcp_gateway')).toBe(false);
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

  it('keeps exact selectors when sample tool names are truncated', () => {
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
        createTool(serverId, `tool-${index}-${toolIndex}-${'n'.repeat(80)}`),
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
  });
});
