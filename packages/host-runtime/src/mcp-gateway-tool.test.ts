import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  HostToolExecutionContext,
  HostToolRegistration,
  McpServerConfig,
  ToolResult,
} from '@piwin/contracts';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { buildMcpGatewayToolDefinition } from './mcp-gateway-tool.js';

type SearchOutput = {
  tools: Array<{
    selector: string;
    serverId: string;
    toolName: string;
    description: string;
  }>;
  discoveredServers: string[];
  discoveryFailures: Array<{ serverId: string; message: string }>;
  remainingUncachedServers: string[];
  uncachedOrEmptyServers: string[];
  note?: string;
};

type DescribeOutput = {
  selector: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: string;
};

const executionContext: HostToolExecutionContext = {
  sessionId: 'mcp-gateway-test-session',
  runtimeGenerationId: 'mcp-gateway-test-generation',
  runId: 'mcp-gateway-test-run',
  toolName: 'mcp_gateway',
};

function fixtureServerPath(): string {
  return fileURLToPath(
    new URL('../../mcp/src/fixtures/fixture-mcp-server-official.mjs', import.meta.url),
  );
}

function fixtureServerConfig(): McpServerConfig {
  return {
    command: process.execPath,
    args: [fixtureServerPath()],
  };
}

async function writeMcpConfig(
  rootDir: string,
  mcpServers: Record<string, McpServerConfig>,
): Promise<void> {
  await writeFile(join(rootDir, 'mcp.json'), JSON.stringify({ mcpServers }), 'utf8');
}

function parseSearchResult(result: ToolResult): SearchOutput {
  if (!result.ok) {
    throw new Error(`Expected search success, got ${result.code}: ${result.message}`);
  }
  return JSON.parse(result.output) as SearchOutput;
}

function parseDescribeResult(result: ToolResult): DescribeOutput {
  if (!result.ok) {
    throw new Error(`Expected describe success, got ${result.code}: ${result.message}`);
  }
  return JSON.parse(result.output) as DescribeOutput;
}

async function executeSearch(
  gateway: HostToolRegistration,
  args: Record<string, unknown> = {},
): Promise<SearchOutput> {
  const result = await gateway.execute(
    { action: 'search', ...args },
    new AbortController().signal,
    executionContext,
  );
  return parseSearchResult(result);
}

async function executeDescribe(
  gateway: HostToolRegistration,
  selector: string,
): Promise<DescribeOutput> {
  const result = await gateway.execute(
    { action: 'describe', selector },
    new AbortController().signal,
    executionContext,
  );
  return parseDescribeResult(result);
}

describe('mcp_gateway search', () => {
  it('discovers an uncached server and returns summaries that require describe for schemas', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-gateway-discover-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const searchCachedSpy = vi.spyOn(lifecycleManager.getMetadataCatalog(), 'searchCached');
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const gateway = buildMcpGatewayToolDefinition({ lifecycleManager });
      expect(gateway.descriptor.parameters.properties).toMatchObject({
        discover: { type: 'boolean', default: true },
      });

      const output = await executeSearch(gateway, {
        query: 'ping',
        limit: Number.MAX_SAFE_INTEGER,
      });

      expect(output.tools).toEqual([
        {
          selector: 'fixture.ping',
          serverId: 'fixture',
          toolName: 'ping',
          description: 'Return pong',
        },
      ]);
      expect(output.tools[0]).not.toHaveProperty('inputSchema');
      expect(searchCachedSpy).toHaveBeenCalledWith('ping', {
        serverId: 'fixture',
        limit: 50,
      });

      const described = await executeDescribe(gateway, 'fixture.ping');
      expect(described).toMatchObject({
        selector: 'fixture.ping',
        inputSchema: { type: 'object', properties: {} },
      });
      expect(output.discoveredServers).toEqual(['fixture']);
      expect(output.discoveryFailures).toEqual([]);
      expect(output.uncachedOrEmptyServers).toEqual([]);
      expect(lifecycleManager.getClient('fixture')).not.toBeNull();
    } finally {
      searchCachedSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('persists discovery and uses the cache on the next search', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-gateway-cache-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const discoverSpy = vi.spyOn(lifecycleManager, 'discoverTools');
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const gateway = buildMcpGatewayToolDefinition({ lifecycleManager });

      const firstOutput = await executeSearch(gateway, { query: 'ping' });
      expect(firstOutput.tools[0]?.selector).toBe('fixture.ping');
      expect(discoverSpy).toHaveBeenCalledTimes(1);

      const metadata = JSON.parse(await readFile(join(rootDir, 'mcp-metadata.json'), 'utf8')) as {
        servers: Record<string, { tools: Array<{ selector: string }> }>;
      };
      expect(metadata.servers.fixture?.tools[0]?.selector).toBe('fixture.ping');

      const secondOutput = await executeSearch(gateway, { query: 'ping' });
      expect(secondOutput.tools[0]?.selector).toBe('fixture.ping');
      expect(secondOutput.discoveredServers).toEqual([]);
      expect(discoverSpy).toHaveBeenCalledTimes(1);
    } finally {
      discoverSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('does not discover an uncached server when discover is false', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-gateway-cache-only-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const discoverSpy = vi.spyOn(lifecycleManager, 'discoverTools');
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const gateway = buildMcpGatewayToolDefinition({ lifecycleManager });

      const output = await executeSearch(gateway, { query: 'ping', discover: false });

      expect(output.tools).toEqual([]);
      expect(output.discoveredServers).toEqual([]);
      expect(output.uncachedOrEmptyServers).toEqual(['fixture']);
      expect(discoverSpy).not.toHaveBeenCalled();
      expect(lifecycleManager.getClient('fixture')).toBeNull();
      expect(output.note).toContain('cached metadata only');
    } finally {
      discoverSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('reports one discovery failure while returning other server hits', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-gateway-failure-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    try {
      await writeMcpConfig(rootDir, {
        broken: { command: 'piwin-missing-mcp-fixture-for-search' },
        fixture: fixtureServerConfig(),
      });
      const gateway = buildMcpGatewayToolDefinition({ lifecycleManager });

      const output = await executeSearch(gateway, { query: 'ping' });

      expect(output.tools).toEqual([expect.objectContaining({ selector: 'fixture.ping' })]);
      expect(output.discoveredServers).toEqual(['fixture']);
      expect(output.discoveryFailures).toHaveLength(1);
      expect(output.discoveryFailures[0]?.serverId).toBe('broken');
      expect(output.remainingUncachedServers).toEqual(['broken']);
      expect(output.uncachedOrEmptyServers).toEqual(['broken']);
      expect(output.note).toContain('Failed discoveries');
    } finally {
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('targets one server and bounds no-server discovery candidates', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-gateway-bound-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const serverIds = Array.from({ length: 10 }, (_, index) => `server-${index}`);
    const calls: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const discoverSpy = vi
      .spyOn(lifecycleManager, 'discoverTools')
      .mockImplementation(async (serverId) => {
        calls.push(serverId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return [];
      });
    try {
      await writeMcpConfig(
        rootDir,
        Object.fromEntries(serverIds.map((serverId) => [serverId, { command: 'true' }])),
      );
      const gateway = buildMcpGatewayToolDefinition({ lifecycleManager });

      await executeSearch(gateway, { serverId: 'server-9' });
      expect(calls).toEqual(['server-9']);

      calls.length = 0;
      await executeSearch(gateway);
      expect(calls).toEqual(serverIds.slice(0, 8));
      expect(maximumActive).toBeLessThanOrEqual(4);
    } finally {
      discoverSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
