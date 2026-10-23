import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandMcp } from './mcp-command.js';

describe('piwin mcp add', () => {
  let root: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-mcp-cli-'));
    previousRoot = process.env.PIWIN_ROOT;
    process.env.PIWIN_ROOT = root;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.PIWIN_ROOT;
    else process.env.PIWIN_ROOT = previousRoot;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function savedServers(): Promise<Record<string, unknown>> {
    const document = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    return document.mcpServers;
  }

  it('saves a remote server with a type and an env-referencing header', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await commandMcp([
      'mcp',
      'add',
      'linear',
      '--url',
      'https://mcp.linear.app/mcp',
      '--type',
      'http',
      '--header',
      'Authorization: Bearer ${LINEAR_TOKEN}',
    ]);
    expect(process.exitCode).toBeUndefined();
    expect((await savedServers()).linear).toEqual({
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: 'Bearer ${LINEAR_TOKEN}' },
    });
  });

  it('refuses an invalid url instead of saving it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await commandMcp(['mcp', 'add', 'bad', '--url', 'ftp://example.com']);
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('mcpServers.bad.url'));
  });

  it('treats --command together with --url as a usage error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await commandMcp(['mcp', 'add', 'both', '--command', 'node', '--url', 'https://x.dev/mcp']);
    expect(process.exitCode).toBe(1);
  });
});
