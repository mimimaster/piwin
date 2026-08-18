import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration, McpServerConfig, SessionToolFamily, ToolResult } from '@piwin/contracts';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { createToolCatalogService } from './catalog-service.js';

type SearchOutput = {
  tools: Array<{
    id: string;
    source: 'host' | 'mcp';
    description: string;
    schema?: { name: string; parameters: Record<string, unknown> };
  }>;
  discoveredServers: string[];
  discoveryFailures: Array<{ serverId: string; message: string }>;
  remainingUncachedServers: string[];
  uncachedOrEmptyServers: string[];
  note?: string;
};

function fixtureServerPath(): string {
  return fileURLToPath(
    new URL('../../../mcp/src/fixtures/fixture-mcp-server-official.mjs', import.meta.url),
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

function hostTool(name: string, family: SessionToolFamily, description: string): HostToolRegistration {
  return {
    descriptor: {
      name,
      description,
      parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
    },
    family,
    permissionSpec: {
      action: 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute() {
      return { ok: true, output: name };
    },
  };
}

describe('tool catalog service MCP search', () => {
  it('discovers an uncached server and inlines schema for top matches', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-discover-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const searchCachedSpy = vi.spyOn(lifecycleManager.getMetadataCatalog(), 'searchCached');
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const catalog = createToolCatalogService({ lifecycleManager });
      const output = parseSearchResult(
        await catalog.searchMcp({ query: 'ping', limit: Number.MAX_SAFE_INTEGER }, new AbortController().signal),
      );

      expect(output.tools).toEqual([
        expect.objectContaining({
          id: 'fixture.ping',
          source: 'mcp',
          description: 'Return pong',
        }),
      ]);
      expect(output.tools[0]?.schema).toMatchObject({
        name: 'fixture.ping',
        parameters: { type: 'object', properties: {} },
      });
      expect(searchCachedSpy).toHaveBeenCalledWith('ping', {
        serverId: 'fixture',
        limit: 50,
      });
      expect(output.discoveredServers).toEqual(['fixture']);
      expect(lifecycleManager.getClient('fixture')).not.toBeNull();
    } finally {
      searchCachedSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('persists discovery and uses the cache on the next search', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-cache-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const discoverSpy = vi.spyOn(lifecycleManager, 'discoverTools');
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const catalog = createToolCatalogService({ lifecycleManager });
      const firstOutput = parseSearchResult(
        await catalog.searchMcp({ query: 'ping' }, new AbortController().signal),
      );
      expect(firstOutput.tools[0]?.id).toBe('fixture.ping');
      expect(discoverSpy).toHaveBeenCalledTimes(1);

      const metadata = JSON.parse(await readFile(join(rootDir, 'mcp-metadata.json'), 'utf8')) as {
        servers: Record<string, { tools: Array<{ selector: string }> }>;
      };
      expect(metadata.servers.fixture?.tools[0]?.selector).toBe('fixture.ping');

      const secondOutput = parseSearchResult(
        await catalog.searchMcp({ query: 'ping' }, new AbortController().signal),
      );
      expect(secondOutput.tools[0]?.id).toBe('fixture.ping');
      expect(secondOutput.discoveredServers).toEqual([]);
      expect(discoverSpy).toHaveBeenCalledTimes(1);
    } finally {
      discoverSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('does not discover an uncached server when discover is false', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-cache-only-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    const discoverSpy = vi.spyOn(lifecycleManager, 'discoverTools');
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const catalog = createToolCatalogService({ lifecycleManager });
      const output = parseSearchResult(
        await catalog.searchMcp({ query: 'ping', discover: false }, new AbortController().signal),
      );
      expect(output.tools).toEqual([]);
      expect(output.discoveredServers).toEqual([]);
      expect(output.uncachedOrEmptyServers).toEqual(['fixture']);
      expect(discoverSpy).not.toHaveBeenCalled();
      expect(output.note).toContain('cached metadata only');
    } finally {
      discoverSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('reports one discovery failure while returning other server hits', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-failure-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    try {
      await writeMcpConfig(rootDir, {
        broken: { command: 'piwin-missing-mcp-fixture-for-search' },
        fixture: fixtureServerConfig(),
      });
      const catalog = createToolCatalogService({ lifecycleManager });
      const output = parseSearchResult(
        await catalog.searchMcp({ query: 'ping' }, new AbortController().signal),
      );
      expect(output.tools).toEqual([expect.objectContaining({ id: 'fixture.ping' })]);
      expect(output.discoveredServers).toEqual(['fixture']);
      expect(output.discoveryFailures).toHaveLength(1);
      expect(output.discoveryFailures[0]?.serverId).toBe('broken');
      expect(output.note).toContain('Failed discoveries');
    } finally {
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('targets one server and bounds no-server discovery candidates', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-bound-'));
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
      const catalog = createToolCatalogService({ lifecycleManager });
      await catalog.searchMcp({ serverId: 'server-9', query: '' }, new AbortController().signal);
      expect(calls).toEqual(['server-9']);

      calls.length = 0;
      await catalog.searchMcp({ query: '' }, new AbortController().signal);
      expect(calls).toEqual(serverIds.slice(0, 8));
      expect(maximumActive).toBeLessThanOrEqual(4);
    } finally {
      discoverSpy.mockRestore();
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('merges host targets with MCP hits and keeps host schema on top matches', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-merge-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const catalog = createToolCatalogService({ lifecycleManager });
      const output = parseSearchResult(
        await catalog.search(
          {
            query: 'ping',
            hostTargets: [hostTool('image_gen', 'image-generation', 'Generate an image')],
          },
          new AbortController().signal,
        ),
      );
      expect(output.tools.some((tool) => tool.id === 'fixture.ping' && tool.schema)).toBe(true);
      expect(output.tools.some((tool) => tool.id === 'image_gen')).toBe(false);
    } finally {
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('describes, calls, and reports status for a discovered MCP tool', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-call-'));
    const lifecycleManager = createMcpLifecycleManager(rootDir);
    try {
      await writeMcpConfig(rootDir, { fixture: fixtureServerConfig() });
      const catalog = createToolCatalogService({ lifecycleManager });
      const signal = new AbortController().signal;
      await catalog.searchMcp({ query: 'ping' }, signal);

      const described = await catalog.describeMcp('fixture.ping', signal);
      expect(described.ok).toBe(true);
      if (!described.ok) {
        throw new Error(described.message);
      }
      expect(JSON.parse(described.output)).toMatchObject({
        name: 'fixture.ping',
        description: 'Return pong',
      });

      const called = await catalog.callMcp('fixture.ping', {}, signal);
      expect(called.ok).toBe(true);
      if (!called.ok) {
        throw new Error(called.message);
      }
      expect(called.output).toContain('pong');

      const status = await catalog.status();
      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.message);
      }
      const parsed = JSON.parse(status.output) as { servers: Array<{ serverId: string }> };
      expect(parsed.servers.some((server) => server.serverId === 'fixture')).toBe(true);
    } finally {
      await lifecycleManager.dispose();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
