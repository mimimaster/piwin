import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from './manifest.js';
import { FEATURED_PLUGINS, findFeaturedPlugin } from './featured-catalog.js';

describe('featured plugin catalog', () => {
  it('ships Cloudflare, GitHub, Remotion, HyperFrames, and Figma', () => {
    expect(FEATURED_PLUGINS.map((entry) => entry.id)).toEqual([
      'cloudflare',
      'github',
      'remotion',
      'hyperframes',
      'figma',
    ]);
  });

  it('exposes manifests that pass plugin.json validation', () => {
    for (const entry of FEATURED_PLUGINS) {
      expect(parsePluginManifest(entry.manifest).id).toBe(entry.id);
    }
  });

  it('finds a featured plugin by id and misses unknown ids', () => {
    expect(findFeaturedPlugin('cloudflare')?.manifest.name).toBe('Cloudflare');
    expect(findFeaturedPlugin('missing')).toBeUndefined();
  });

  it('requires a GitHub PAT and leaves Cloudflare secret-free', () => {
    expect(findFeaturedPlugin('cloudflare')?.manifest.secrets).toBeUndefined();
    expect(findFeaturedPlugin('github')?.manifest.secrets).toEqual([
      expect.objectContaining({
        name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        required: true,
      }),
    ]);
  });

  it('ships Remotion as git-backed skills and Figma/HyperFrames as remote MCP', () => {
    const remotion = findFeaturedPlugin('remotion');
    expect(remotion?.gitSource?.url).toBe('https://github.com/remotion-dev/skills.git');
    expect(remotion?.manifest.mcpServers).toBeUndefined();
    expect(remotion?.manifest.skills?.length).toBeGreaterThan(0);
    expect(findFeaturedPlugin('figma')?.manifest.mcpServers?.figma?.args).toEqual([
      '-y',
      'mcp-remote',
      'https://mcp.figma.com/mcp',
    ]);
    expect(findFeaturedPlugin('hyperframes')?.manifest.mcpServers?.hyperframes?.args).toEqual([
      '-y',
      'mcp-remote',
      'https://mcp.heygen.com/mcp/hyperframes/',
    ]);
  });
});
