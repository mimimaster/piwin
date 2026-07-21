import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcpLifecycleManager } from './mcp-lifecycle-manager.js';

describe('createMcpLifecycleManager', () => {
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
});
