/**
 * Catalog builder for `@` mentions in composer.
 */
import type { AtItem } from './at-types';

export type AtCatalogOptions = {
  projectPath?: string | null;
  mcpServers?: Array<{ id: string; name: string; status?: string }>;
  recentFiles?: string[];
  recentFolders?: string[];
};

export function buildAtCatalog(options: AtCatalogOptions = {}): AtItem[] {
  const catalog: AtItem[] = [
    {
      id: 'ctx-workspace',
      kind: 'context',
      name: 'workspace',
      label: '@workspace',
      description: 'Include current project tree & root overview',
      insertValue: '@workspace ',
      groupLabel: 'System Context',
      badge: 'Context',
    },
    {
      id: 'ctx-terminal',
      kind: 'context',
      name: 'terminal',
      label: '@terminal',
      description: 'Include current active terminal output logs',
      insertValue: '@terminal ',
      groupLabel: 'System Context',
      badge: 'Context',
    },
    {
      id: 'git-status',
      kind: 'git',
      name: 'git:status',
      label: '@git:status',
      description: 'Include working tree status & modified file list',
      insertValue: '@git:status ',
      groupLabel: 'Git Context',
      badge: 'Git',
    },
    {
      id: 'git-diff',
      kind: 'git',
      name: 'git:diff',
      label: '@git:diff',
      description: 'Include current uncommitted git diff',
      insertValue: '@git:diff ',
      groupLabel: 'Git Context',
      badge: 'Git',
    },
  ];

  if (options.mcpServers && options.mcpServers.length > 0) {
    for (const server of options.mcpServers) {
      catalog.push({
        id: `mcp-${server.id}`,
        kind: 'mcp',
        name: `mcp:${server.name.toLowerCase()}`,
        label: `@mcp:${server.name}`,
        description: `MCP Server tool capabilities for ${server.name}`,
        insertValue: `@mcp:${server.name} `,
        groupLabel: 'MCP Server',
        badge: 'MCP',
      });
    }
  }

  if (options.recentFiles && options.recentFiles.length > 0) {
    for (const file of options.recentFiles) {
      catalog.push({
        id: `file-${file}`,
        kind: 'file',
        name: file,
        label: `@${file}`,
        description: `Include file content: ${file}`,
        insertValue: `@${file} `,
        groupLabel: 'Workspace File',
        badge: 'File',
      });
    }
  }

  if (options.recentFolders && options.recentFolders.length > 0) {
    for (const folder of options.recentFolders) {
      catalog.push({
        id: `folder-${folder}`,
        kind: 'folder',
        name: folder,
        label: `@${folder}`,
        description: `Include folder content: ${folder}`,
        insertValue: `@${folder} `,
        groupLabel: 'Workspace File',
        badge: 'Folder',
      });
    }
  }

  return catalog;
}
