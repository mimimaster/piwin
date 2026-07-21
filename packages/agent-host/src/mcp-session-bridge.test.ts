import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { allowMcpServer, openOrCreateProject } from '@piwin/project';
import { createMcpSessionBridge } from './mcp-session-bridge.js';

const fixtureServerPath = fileURLToPath(
  // Use mcp package official fixture so @modelcontextprotocol/sdk resolves.
  new URL('../../mcp/src/fixtures/fixture-mcp-server-official.mjs', import.meta.url),
);

describe('createMcpSessionBridge + lifecycleManager', () => {
  it('reuses the same process when manager already started the server', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-bridge-'));
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

    const manager = createMcpLifecycleManager(rootDir);
    try {
      const started = await manager.start('fixture');
      expect(started.status).toBe('running');
      expect(typeof started.pid).toBe('number');
      const firstPid = started.pid;

      const bridge = await createMcpSessionBridge({
        piwinRoot: rootDir,
        sessionId: 'session-shared',
        lifecycleManager: manager,
        requestPermission: async () => 'allow',
      });

      expect(bridge.warnings).toEqual([]);
      expect(bridge.serverCount).toBe(1);
      expect(bridge.toolCount).toBe(1);

      const healthAfterBridge = await manager.listHealth();
      const fixtureHealth = healthAfterBridge.find((item) => item.serverId === 'fixture');
      expect(fixtureHealth?.status).toBe('running');
      expect(fixtureHealth?.pid).toBe(firstPid);

      const client = manager.getClient('fixture');
      expect(client?.pid).toBe(firstPid);

      const pingResult = await bridge.tools[0]?.execute({}, undefined);
      expect(String(pingResult)).toContain('pong');

      // Bridge close must not stop host-owned process.
      await bridge.close();
      const stillRunning = await manager.listHealth();
      expect(stillRunning.find((item) => item.serverId === 'fixture')?.status).toBe('running');
      expect(stillRunning.find((item) => item.serverId === 'fixture')?.pid).toBe(firstPid);
    } finally {
      await manager.dispose();
    }
  });

  it('dispose of host-owned manager kills the child process', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-dispose-'));
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

    const manager = createMcpLifecycleManager(rootDir);
    const started = await manager.start('fixture');
    expect(started.status).toBe('running');
    const childPid = started.pid;
    expect(typeof childPid).toBe('number');

    await manager.dispose();

    // Process should no longer be alive after dispose.
    if (typeof childPid === 'number') {
      let alive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        alive = false;
      }
      // Give SIGTERM a moment if needed.
      if (alive) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        try {
          process.kill(childPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    }
  });

  it('without manager, bridge owns and closes its own client', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-owned-'));
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

    const bridge = await createMcpSessionBridge({
      piwinRoot: rootDir,
      sessionId: 'session-owned',
      requestPermission: async () => 'allow',
    });
    expect(bridge.serverCount).toBe(1);
    expect(bridge.toolCount).toBe(1);
    const result = await bridge.tools[0]?.execute({}, undefined);
    expect(String(result)).toContain('pong');
    await bridge.close();
  });

  it('skips mcp:connect permission when project remembers the server', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-remember-'));
    const projectPath = join(rootDir, 'proj');
    const projectsFile = join(rootDir, 'projects.json');
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
    await openOrCreateProject(projectsFile, projectPath, { trust: 'trusted' });
    await allowMcpServer(projectsFile, projectPath, 'fixture');

    let permissionCalls = 0;
    const bridge = await createMcpSessionBridge({
      piwinRoot: rootDir,
      sessionId: 'session-remember',
      projectPath,
      projectsFilePath: projectsFile,
      requestPermission: async () => {
        permissionCalls += 1;
        return 'deny';
      },
    });

    expect(permissionCalls).toBe(0);
    expect(bridge.serverCount).toBe(1);
    expect(bridge.toolCount).toBe(1);
    await bridge.close();
  });

  it('skips mcp:tool-call permission when project remembers the server', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-tool-remember-'));
    const projectPath = join(rootDir, 'proj');
    const projectsFile = join(rootDir, 'projects.json');
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
    await openOrCreateProject(projectsFile, projectPath, { trust: 'trusted' });
    await allowMcpServer(projectsFile, projectPath, 'fixture');

    const permissionActions: string[] = [];
    const bridge = await createMcpSessionBridge({
      piwinRoot: rootDir,
      sessionId: 'session-tool-remember',
      projectPath,
      projectsFilePath: projectsFile,
      requestPermission: async (request) => {
        permissionActions.push(request.action);
        return 'deny';
      },
    });

    expect(permissionActions).toEqual([]);
    expect(bridge.toolCount).toBe(1);

    const result = await bridge.tools[0]?.execute({}, undefined);
    expect(String(result)).toContain('pong');
    // Tool-call must not re-prompt when server is allowlisted.
    expect(permissionActions).toEqual([]);

    await bridge.close();
  });

  it('still asks mcp:tool-call when server is not allowlisted', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-tool-ask-'));
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

    const permissionActions: string[] = [];
    const bridge = await createMcpSessionBridge({
      piwinRoot: rootDir,
      sessionId: 'session-tool-ask',
      requestPermission: async (request) => {
        permissionActions.push(request.action);
        return 'allow';
      },
    });

    expect(permissionActions).toEqual(['mcp:connect']);
    permissionActions.length = 0;

    const result = await bridge.tools[0]?.execute({}, undefined);
    expect(String(result)).toContain('pong');
    expect(permissionActions).toEqual(['mcp:tool-call']);

    await bridge.close();
  });
});
