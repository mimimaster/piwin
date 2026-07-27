import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { createMcpSessionBridge } from './mcp-session-bridge.js';

const fixtureServerPath = fileURLToPath(
  new URL('../../mcp/src/fixtures/fixture-mcp-server-official.mjs', import.meta.url),
);

async function writeFixtureConfig(rootDir: string): Promise<void> {
  await writeFile(
    join(rootDir, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [fixtureServerPath],
        },
      },
    }),
    'utf8',
  );
}

describe('createMcpSessionBridge (cached + gateway)', () => {
  it('creates session tools without any MCP transport when cache is empty', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-bridge-empty-'));
    await writeFixtureConfig(rootDir);

    const manager = createMcpLifecycleManager(rootDir);
    try {
      let permissionCalls = 0;
      const bridge = await createMcpSessionBridge({
        piwinRoot: rootDir,
        sessionId: 's1',
        lifecycleManager: manager,
        requestPermission: async () => {
          permissionCalls += 1;
          return 'allow';
        },
      });

      expect(permissionCalls).toBe(0);
      expect(bridge.tools.some((tool) => tool.name === 'mcp_gateway')).toBe(true);
      expect(bridge.tools.filter((tool) => tool.name !== 'mcp_gateway')).toHaveLength(0);
      expect(manager.getClient('fixture')).toBeNull();

      await bridge.close();
      expect(manager.getClient('fixture')).toBeNull();
    } finally {
      await manager.dispose();
    }
  });

  it('exposes direct tools from cache and lazy-connects only on execute', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-bridge-cache-'));
    await writeFixtureConfig(rootDir);
    const manager = createMcpLifecycleManager(rootDir);
    try {
      await manager.discoverTools('fixture');
      await manager.stop('fixture');
      expect(manager.getClient('fixture')).toBeNull();

      const permissionActions: string[] = [];
      const bridge = await createMcpSessionBridge({
        piwinRoot: rootDir,
        sessionId: 's2',
        lifecycleManager: manager,
        requestPermission: async (request) => {
          permissionActions.push(request.action);
          return 'allow';
        },
      });

      expect(permissionActions).toEqual([]);
      expect(manager.getClient('fixture')).toBeNull();
      const direct = bridge.tools.find((tool) => tool.name.startsWith('mcp__fixture__'));
      expect(direct).toBeTruthy();
      expect(bridge.tools.some((tool) => tool.name === 'mcp_gateway')).toBe(true);

      const result = await direct?.execute({}, undefined);
      expect(String(result)).toContain('pong');
      expect(permissionActions).toEqual(['mcp:tool-call']);
      expect(manager.getClient('fixture')).toBeTruthy();

      await bridge.close();
      expect(manager.getClient('fixture')).toBeTruthy();
    } finally {
      await manager.dispose();
    }
  });

  it('gateway search works from cache without connecting', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-bridge-search-'));
    await writeFixtureConfig(rootDir);
    const manager = createMcpLifecycleManager(rootDir);
    try {
      await manager.discoverTools('fixture');
      await manager.stop('fixture');

      const bridge = await createMcpSessionBridge({
        piwinRoot: rootDir,
        sessionId: 's3',
        lifecycleManager: manager,
      });
      const gateway = bridge.tools.find((tool) => tool.name === 'mcp_gateway');
      expect(gateway).toBeTruthy();

      const raw = await gateway?.execute({ action: 'search', query: 'ping' }, undefined);
      expect(String(raw)).toContain('fixture');
      expect(manager.getClient('fixture')).toBeNull();
      await bridge.close();
    } finally {
      await manager.dispose();
    }
  });

  it('does not return cached metadata after the server config changes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-bridge-stale-'));
    await writeFixtureConfig(rootDir);
    const manager = createMcpLifecycleManager(rootDir);
    try {
      await manager.discoverTools('fixture');
      await manager.stop('fixture');
      await writeFile(
        join(rootDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            fixture: {
              command: process.execPath,
              args: [fixtureServerPath, '--changed-config'],
            },
          },
        }),
        'utf8',
      );

      const bridge = await createMcpSessionBridge({
        piwinRoot: rootDir,
        sessionId: 's4',
        lifecycleManager: manager,
      });
      const gateway = bridge.tools.find((tool) => tool.name === 'mcp_gateway');
      const raw = await gateway?.execute({ action: 'search', query: 'ping' }, undefined);
      const result = JSON.parse(String(raw)) as {
        tools: Array<{ selector: string }>;
        uncachedOrEmptyServers: string[];
      };

      expect(result.tools).toEqual([]);
      expect(result.uncachedOrEmptyServers).toContain('fixture');
      await bridge.close();
    } finally {
      await manager.dispose();
    }
  });
});
