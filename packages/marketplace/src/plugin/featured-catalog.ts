/**
 * First-party marketplace plugins shipped with the Host.
 * Users opt in from Settings → Plugins; nothing here auto-installs.
 */
import type { PluginManifest } from '@piwin/contracts';

export type FeaturedPluginCategory = 'featured';

export type FeaturedPluginGitSource = {
  url: string;
  ref?: string;
};

export type FeaturedPluginEntry = {
  id: string;
  category: FeaturedPluginCategory;
  manifest: PluginManifest;
  gitSource?: FeaturedPluginGitSource;
};

const CLOUDFLARE_MANIFEST: PluginManifest = {
  id: 'cloudflare',
  version: '1.0.0',
  name: 'Cloudflare',
  description: 'Connect to Cloudflare using remote MCP servers',
  mcpServers: {
    api: {
      command: 'npx',
      args: [
        '-y',
        'mcp-remote',
        'https://mcp.cloudflare.com/mcp',
        '--protocol',
        'auto',
        '--auth-timeout',
        '90',
        '--static-oauth-client-metadata',
        '{"scope":"user:read"}',
      ],
    },
    docs: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://docs.mcp.cloudflare.com/mcp'],
    },
  },
};

const GITHUB_MANIFEST: PluginManifest = {
  id: 'github',
  version: '1.0.0',
  name: 'GitHub',
  description: 'Connect to GitHub using remote MCP servers',
  mcpServers: {
    github: {
      command: 'npx',
      args: [
        '-y',
        'mcp-remote',
        'https://api.githubcopilot.com/mcp/',
        '--header',
        'Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}',
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}',
      },
    },
  },
  secrets: [
    {
      name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
      displayName: 'GitHub personal access token',
      description: 'A classic or fine-grained PAT with the repo scopes you want the agent to use.',
      required: true,
    },
  ],
};

const FIGMA_MANIFEST: PluginManifest = {
  id: 'figma',
  version: '1.0.0',
  name: 'Figma',
  description: 'Design-to-code workflows from Figma files',
  mcpServers: {
    figma: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.figma.com/mcp'],
    },
  },
};

const HYPERFRAMES_MANIFEST: PluginManifest = {
  id: 'hyperframes',
  version: '1.0.0',
  name: 'HyperFrames',
  description: 'Write HTML, render video',
  mcpServers: {
    hyperframes: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.heygen.com/mcp/hyperframes/'],
    },
  },
};

const REMOTION_MANIFEST: PluginManifest = {
  id: 'remotion',
  version: '1.0.0',
  name: 'Remotion',
  description: 'Create motion graphics from React',
  skills: [
    'skills/remotion-best-practices',
    'skills/remotion-captions',
    'skills/remotion-create',
    'skills/remotion-docs',
    'skills/remotion-interactivity',
    'skills/remotion-maps',
    'skills/remotion-markup',
    'skills/remotion-multimedia',
    'skills/remotion-render',
    'skills/remotion-saas',
    'skills/remotion-studio',
    'skills/remotion-upgrade',
  ],
};

export const FEATURED_PLUGINS: readonly FeaturedPluginEntry[] = [
  { id: 'cloudflare', category: 'featured', manifest: CLOUDFLARE_MANIFEST },
  { id: 'github', category: 'featured', manifest: GITHUB_MANIFEST },
  {
    id: 'remotion',
    category: 'featured',
    manifest: REMOTION_MANIFEST,
    gitSource: { url: 'https://github.com/remotion-dev/skills.git' },
  },
  { id: 'hyperframes', category: 'featured', manifest: HYPERFRAMES_MANIFEST },
  { id: 'figma', category: 'featured', manifest: FIGMA_MANIFEST },
];

export function findFeaturedPlugin(pluginId: string): FeaturedPluginEntry | undefined {
  return FEATURED_PLUGINS.find((entry) => entry.id === pluginId);
}
