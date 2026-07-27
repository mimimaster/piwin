import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcpMetadataCatalog } from './mcp-metadata-catalog.js';
import { fingerprintMcpServerConfig } from './mcp-fingerprint.js';

describe('McpMetadataCatalog', () => {
  it('search/describe work from cache without live clients', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-meta-'));
    const catalog = createMcpMetadataCatalog(rootDir);
    const config = { command: 'node', args: ['server.js'] };

    await catalog.replaceServerMetadata('docs', config, [
      {
        name: 'search',
        description: 'Search documentation',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
      {
        name: 'read',
        description: 'Read a page',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);

    const hits = await catalog.searchCached('search');
    expect(hits.map((item) => item.selector)).toEqual(['docs.search']);

    const described = await catalog.describeCached('docs.read');
    expect(described?.toolName).toBe('read');
    expect(described?.inputSchema).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
    });
    expect(described?.metadataFingerprint).toBe(
      fingerprintMcpServerConfig('docs', config),
    );
  });

  it('invalidates cache when server fingerprint changes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-meta-fp-'));
    const catalog = createMcpMetadataCatalog(rootDir);
    const original = { command: 'node', args: ['a.js'] };
    const changed = { command: 'node', args: ['b.js'] };

    await catalog.replaceServerMetadata('svc', original, [
      { name: 'ping', description: 'Ping' },
    ]);
    expect(await catalog.isServerCacheValid('svc', original)).toBe(true);
    expect(await catalog.isServerCacheValid('svc', changed)).toBe(false);

    await catalog.markServerStale('svc');
    expect(await catalog.listCachedForServer('svc')).toEqual([]);
    expect(await catalog.describeCached('svc.ping')).toBeNull();
  });

  it('changes the fingerprint when an environment value changes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-mcp-meta-env-'));
    const catalog = createMcpMetadataCatalog(rootDir);
    const original = {
      command: 'node',
      env: { MCP_ENDPOINT: 'https://old.example.test' },
    };
    const changed = {
      command: 'node',
      env: { MCP_ENDPOINT: 'https://new.example.test' },
    };

    await catalog.replaceServerMetadata('svc', original, [
      { name: 'ping', description: 'Ping' },
    ]);

    expect(await catalog.isServerCacheValid('svc', original)).toBe(true);
    expect(await catalog.isServerCacheValid('svc', changed)).toBe(false);
  });
});
