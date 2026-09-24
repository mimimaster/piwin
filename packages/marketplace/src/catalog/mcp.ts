/**
 * Curated stdio MCP servers. Commands pin an exact package version so a
 * later publish cannot silently change what runs on the Host. Servers that
 * duplicate built-in Host tools (filesystem, fetch, git, browser) are left out,
 * as are servers needing runtimes most Hosts lack (uvx) until they are tested.
 */
import type { MarketplaceCatalogEntry } from '@piwin/contracts';

export const MCP_CATALOG: MarketplaceCatalogEntry[] = [
  {
    entryId: 'mcp:memory',
    capabilityId: 'memory',
    kind: 'mcp',
    category: 'docs-research',
    name: { en: 'Knowledge-graph memory', zhCN: '知识图谱记忆' },
    summary: {
      en: 'Persistent entities and relations the agent can store and recall.',
      zhCN: 'Agent 可持续写入和查询的实体-关系记忆。',
    },
    description: {
      en: 'Reference MCP memory server. Data is stored locally in a JSON file next to the server package.',
      zhCN: 'MCP 官方参考记忆服务，数据以 JSON 文件形式保存在本机。',
    },
    version: '2026.8.31',
    author: 'Model Context Protocol',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    sourceLabel: 'npm',
    install: {
      kind: 'mcp',
      serverId: 'memory',
      draft: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory@2026.8.31'] },
    },
    requirements: [
      {
        kind: 'command',
        value: 'node / npx',
        required: true,
        description: { en: 'Node.js on the Host PATH.', zhCN: 'Host 的 PATH 中需有 Node.js。' },
      },
    ],
    examples: [
      {
        title: { en: 'Remember a preference', zhCN: '记住一个偏好' },
        prompt: {
          en: 'Remember that I prefer pnpm over npm in every project.',
          zhCN: '记住：我在所有项目里都更喜欢用 pnpm 而不是 npm。',
        },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: true,
  },
  {
    entryId: 'mcp:sequential-thinking',
    capabilityId: 'sequential-thinking',
    kind: 'mcp',
    category: 'docs-research',
    name: { en: 'Sequential thinking', zhCN: '分步推理' },
    summary: {
      en: 'A scratchpad tool for breaking a hard problem into revisable steps.',
      zhCN: '把难题拆成可修订步骤的推理草稿工具。',
    },
    description: {
      en: 'Reference MCP server that lets the model record, branch and revise a chain of thoughts explicitly.',
      zhCN: 'MCP 官方参考服务，让模型显式记录、分支并修订思考链。',
    },
    version: '2026.8.31',
    author: 'Model Context Protocol',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    sourceLabel: 'npm',
    install: {
      kind: 'mcp',
      serverId: 'sequential-thinking',
      draft: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking@2026.8.31'],
      },
    },
    requirements: [
      {
        kind: 'command',
        value: 'node / npx',
        required: true,
        description: { en: 'Node.js on the Host PATH.', zhCN: 'Host 的 PATH 中需有 Node.js。' },
      },
    ],
    examples: [
      {
        title: { en: 'Plan a migration', zhCN: '规划一次迁移' },
        prompt: {
          en: 'Think step by step about migrating this app from REST to GraphQL.',
          zhCN: '一步步想清楚把这个应用从 REST 迁到 GraphQL 的方案。',
        },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: false,
  },
];
