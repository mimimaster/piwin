import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectHandcraftedMcpStdio,
  connectMcpStdio,
} from './mcp-client.js';
import { connectOfficialMcpStdio } from './mcp-client-official.js';

const officialFixturePath = fileURLToPath(
  new URL('./fixtures/fixture-mcp-server-official.mjs', import.meta.url),
);
const ndjsonFixturePath = fileURLToPath(
  new URL('./fixtures/fixture-mcp-server-ndjson.mjs', import.meta.url),
);

const previousClientEnv = process.env.PIWIN_MCP_CLIENT;

afterEach(() => {
  if (previousClientEnv === undefined) {
    delete process.env.PIWIN_MCP_CLIENT;
  } else {
    process.env.PIWIN_MCP_CLIENT = previousClientEnv;
  }
});

describe('MCP transport clients', () => {
  it('official client talks to Content-Length fixture', async () => {
    const client = await connectOfficialMcpStdio('fixture', {
      command: process.execPath,
      args: [officialFixturePath],
    });
    try {
      const tools = await client.listTools();
      expect(tools.some((tool) => tool.name === 'ping')).toBe(true);
      const result = await client.callTool('ping', {});
      expect(JSON.stringify(result)).toContain('pong');
      expect(typeof client.pid).toBe('number');
    } finally {
      await client.close();
    }
  });

  it('handcrafted client talks to NDJSON fixture', async () => {
    const client = await connectHandcraftedMcpStdio('fixture', {
      command: process.execPath,
      args: [ndjsonFixturePath],
    });
    try {
      const tools = await client.listTools();
      expect(tools.some((tool) => tool.name === 'ping')).toBe(true);
      const result = await client.callTool('ping', {});
      expect(JSON.stringify(result)).toContain('pong');
    } finally {
      await client.close();
    }
  });

  it('connectMcpStdio auto prefers official for Content-Length servers', async () => {
    delete process.env.PIWIN_MCP_CLIENT;
    const client = await connectMcpStdio('fixture', {
      command: process.execPath,
      args: [officialFixturePath],
    });
    try {
      const tools = await client.listTools();
      expect(tools[0]?.name).toBe('ping');
    } finally {
      await client.close();
    }
  });

  it('connectMcpStdio prefer handcrafted uses NDJSON path', async () => {
    const client = await connectMcpStdio(
      'fixture',
      {
        command: process.execPath,
        args: [ndjsonFixturePath],
      },
      { prefer: 'handcrafted' },
    );
    try {
      const tools = await client.listTools();
      expect(tools[0]?.name).toBe('ping');
    } finally {
      await client.close();
    }
  });

  it('connectMcpStdio fails clearly when binary is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mcp-missing-'));
    await expect(
      connectMcpStdio(
        'missing',
        { command: join(root, 'no-such-mcp-binary') },
        { prefer: 'handcrafted' },
      ),
    ).rejects.toThrow();
  });
});
