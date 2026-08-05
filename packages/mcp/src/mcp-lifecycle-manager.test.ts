import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createMcpLifecycleManager } from './mcp-lifecycle-manager.js';

describe('createMcpLifecycleManager', () => {
  // Safety net: kill any MCP fixture child processes that survived dispose().
  // This prevents orphaned node processes from accumulating across test runs
  // when a fixture intentionally ignores SIGTERM (e.g. hanging-connect fixture).
  // We scan for fixture-mcp-server processes whose parent PID is this process
  // or PID 1 (orphaned) at afterAll time.
  afterAll(async () => {
    const { execSync } = await import('node:child_process');
    try {
      const output = execSync(
        'ps -eo pid,ppid,command | grep "fixture-mcp-server" | grep -v grep',
        { encoding: 'utf8' },
      );
      for (const line of output.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pidStr = parts[0];
        const ppidStr = parts[1];
        if (pidStr === undefined || ppidStr === undefined) {
          continue;
        }
        const pid = parseInt(pidStr, 10);
        const ppid = parseInt(ppidStr, 10);
        // Kill orphans (ppid=1) or children of this process
        if (ppid === 1 || ppid === process.pid) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
        }
      }
    } catch {
      // ps found nothing or failed — no cleanup needed
    }
  });

  it('reports disabled and stopped servers from config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-'));
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          offline: { command: 'false', disabled: true },
          echo: { command: 'true' },
        },
      }),
      'utf8',
    );
    const manager = createMcpLifecycleManager(root);
    const health = await manager.listHealth();
    expect(health.find((item) => item.serverId === 'offline')?.status).toBe('disabled');
    expect(health.find((item) => item.serverId === 'echo')?.status).toBe('stopped');
    await manager.dispose();
  });

  it('records error status when start fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-err-'));
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          missing: { command: 'piwin-definitely-missing-binary-xyz' },
        },
      }),
      'utf8',
    );
    const manager = createMcpLifecycleManager(root);
    const health = await manager.start('missing');
    expect(health.status).toBe('error');
    expect(health.lastError).toBeTruthy();
    const stopped = await manager.stop('missing');
    expect(stopped.status).toBe('stopped');
    await manager.dispose();
  });

  it('marks error when running process exits unexpectedly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-exit-'));
    const { fileURLToPath } = await import('node:url');
    const fixtureServerPath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
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

    const manager = createMcpLifecycleManager(root);
    try {
      const started = await manager.start('fixture');
      expect(started.status).toBe('running');
      const childPid = started.pid;
      expect(typeof childPid).toBe('number');

      if (typeof childPid === 'number') {
        process.kill(childPid, 'SIGTERM');
      }

      // Wait for exit watchdog to flip status.
      let health = started;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const listed = await manager.listHealth();
        const current = listed.find((item) => item.serverId === 'fixture');
        if (current) {
          health = current;
        }
        if (health.status === 'error') {
          break;
        }
      }

      expect(health.status).toBe('error');
      expect(health.lastError).toBeTruthy();
      expect(manager.getClient('fixture')).toBeNull();
    } finally {
      await manager.dispose();
    }
  });

  it('restarts once when restartOnCrash is true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-restart-'));
    const { fileURLToPath } = await import('node:url');
    const fixtureServerPath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [fixtureServerPath],
            restartOnCrash: true,
          },
        },
      }),
      'utf8',
    );

    const manager = createMcpLifecycleManager(root);
    try {
      const started = await manager.start('fixture');
      expect(started.status).toBe('running');
      const firstPid = started.pid;
      expect(typeof firstPid).toBe('number');

      if (typeof firstPid === 'number') {
        process.kill(firstPid, 'SIGTERM');
      }

      let health = started;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const listed = await manager.listHealth();
        const current = listed.find((item) => item.serverId === 'fixture');
        if (current) {
          health = current;
        }
        if (
          health.status === 'running' &&
          typeof health.pid === 'number' &&
          health.pid !== firstPid
        ) {
          break;
        }
      }

      expect(health.status).toBe('running');
      expect(health.pid).not.toBe(firstPid);
      expect(typeof health.pid).toBe('number');
    } finally {
      await manager.dispose();
    }
  });

  it('discards a client when a tool call times out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-timeout-'));
    const { fileURLToPath } = await import('node:url');
    const fixtureServerPath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [fixtureServerPath],
            env: { PIWIN_FIXTURE_HANG_CALL: '1' },
          },
        },
      }),
      'utf8',
    );

    const manager = createMcpLifecycleManager(root, {
      callTimeoutMs: 50,
    });
    try {
      await expect(manager.callTool('fixture', 'ping', {})).rejects.toThrow(
        'MCP tool call timeout',
      );
      expect(manager.getClient('fixture')).toBeNull();
    } finally {
      await manager.dispose();
    }
  });

  it('aborts a hung tools/list and disposes the client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-abort-list-'));
    const { fileURLToPath } = await import('node:url');
    const fixtureServerPath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [fixtureServerPath],
            env: { PIWIN_FIXTURE_HANG_LIST: '1' },
          },
        },
      }),
      'utf8',
    );

    const manager = createMcpLifecycleManager(root, {
      listToolsTimeoutMs: 5_000,
    });
    const abortController = new AbortController();
    try {
      const listing = manager.discoverTools('fixture', abortController.signal);
      setTimeout(() => abortController.abort(), 50);
      await expect(listing).rejects.toThrow('MCP operation aborted');
      expect(manager.getClient('fixture')).toBeNull();
    } finally {
      await manager.dispose();
    }
  });

  it('aborts a hung tools/call and disposes the client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-abort-call-'));
    const { fileURLToPath } = await import('node:url');
    const fixtureServerPath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [fixtureServerPath],
            env: { PIWIN_FIXTURE_HANG_CALL: '1' },
          },
        },
      }),
      'utf8',
    );

    const manager = createMcpLifecycleManager(root, {
      callTimeoutMs: 5_000,
    });
    const abortController = new AbortController();
    try {
      const call = manager.callTool('fixture', 'ping', {}, abortController.signal);
      setTimeout(() => abortController.abort(), 50);
      await expect(call).rejects.toThrow('MCP operation aborted');
      expect(manager.getClient('fixture')).toBeNull();
    } finally {
      await manager.dispose();
    }
  });

  it('reports error when connect hangs (no init response)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-connect-hang-'));
    const { fileURLToPath } = await import('node:url');
    const hangFixturePath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-hanging-connect.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          hangFixture: {
            command: process.execPath,
            args: [hangFixturePath],
          },
        },
      }),
      'utf8',
    );

    const manager = createMcpLifecycleManager(root, {
      connectTimeoutMs: 2_000,
    });
    try {
      const health = await manager.start('hangFixture');
      // After connect timeout, the server should be in error state.
      expect(health.status).toBe('error');
      expect(health.lastError).toBeTruthy();
      // The long-running process should have been cleaned up.
      expect(manager.getClient('hangFixture')).toBeNull();
    } finally {
      await manager.dispose();
    }
  });

  it('late MCP connect hang does not pollute a subsequent start', async () => {
    // Regression: after a hanging connect, starting the same server again
    // must produce a fresh, healthy client.
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-life-late-pollute-'));
    const { fileURLToPath } = await import('node:url');
    const hangFixturePath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-hanging-connect.mjs', import.meta.url),
    );
    const officialFixturePath = fileURLToPath(
      new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
    );
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [hangFixturePath],
          },
        },
      }),
      'utf8',
    );

    const manager = createMcpLifecycleManager(root, {
      connectTimeoutMs: 1_000,
    });
    try {
      // First connect attempt hangs and times out.
      const firstHealth = await manager.start('fixture');
      expect(firstHealth.status).toBe('error');
      expect(manager.getClient('fixture')).toBeNull();

      // Now change the config to point to the healthy fixture (simulates config change).
      await writeFile(
        join(root, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            fixture: {
              command: process.execPath,
              args: [officialFixturePath],
            },
          },
        }),
        'utf8',
      );

      // Second start must pick up the new config and connect successfully.
      const secondHealth = await manager.start('fixture');
      expect(secondHealth.status).toBe('running');
      expect(typeof secondHealth.pid).toBe('number');
      expect(manager.getClient('fixture')).not.toBeNull();
    } finally {
      await manager.dispose();
    }
  });
});
