/**
 * Mock-Host marketplace fixtures for browser dev and e2e. The real catalog
 * ships inside the Host (`@piwin/marketplace`), which the browser bundle
 * cannot import; these entries only exercise the UI states.
 */
import type {
  MarketplaceCatalogEntry,
  MarketplaceCatalogListData,
  MarketplaceInstalledListData,
} from '@piwin/contracts';

const MOCK_ENTRIES: MarketplaceCatalogEntry[] = [
  {
    entryId: 'extension:pi-lens',
    capabilityId: 'pi-lens',
    kind: 'extension',
    category: 'code-development',
    name: { en: 'pi-lens', zhCN: 'pi-lens 代码反馈' },
    summary: {
      en: 'Real-time LSP, linter and type-check feedback while the agent edits.',
      zhCN: 'Agent 改代码时实时给出 LSP、lint 与类型检查反馈。',
    },
    description: { en: 'Mock entry.', zhCN: '模拟条目。' },
    version: '4.2.1',
    author: 'apmantza',
    sourceLabel: 'npm',
    install: { kind: 'pi-package', source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' } },
    requirements: [],
    examples: [
      {
        title: { en: 'Fix type errors', zhCN: '修复类型错误' },
        prompt: { en: 'Refactor src/index.ts without type errors.', zhCN: '重构 src/index.ts，并保证没有类型错误。' },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: true,
  },
  {
    entryId: 'skill:doc-coauthoring',
    capabilityId: 'doc-coauthoring',
    kind: 'skill',
    category: 'docs-research',
    name: { en: 'Doc Co-authoring', zhCN: '文档协作写作' },
    summary: {
      en: 'A structured workflow for specs, proposals and decision docs.',
      zhCN: '为规格说明、提案、决策文档提供结构化写作流程。',
    },
    description: { en: 'Mock entry.', zhCN: '模拟条目。' },
    version: '34040c9c568585f6929bedeaad110ad08f079624',
    author: 'Anthropic',
    sourceLabel: 'GitHub',
    install: {
      kind: 'skill',
      source: {
        kind: 'git',
        url: 'https://github.com/anthropics/skills.git',
        ref: '34040c9c568585f6929bedeaad110ad08f079624',
        subdir: 'skills/doc-coauthoring',
      },
    },
    requirements: [],
    examples: [
      {
        title: { en: 'Write a proposal', zhCN: '写一份提案' },
        prompt: { en: 'Help me write a proposal.', zhCN: '帮我写一份提案。' },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: true,
  },
  {
    entryId: 'mcp:time',
    capabilityId: 'time',
    kind: 'mcp',
    category: 'external-service',
    name: { en: 'Time & time zones', zhCN: '时间与时区' },
    summary: { en: 'Current time and time-zone conversion.', zhCN: '获取当前时间并做时区换算。' },
    description: { en: 'Mock entry.', zhCN: '模拟条目。' },
    version: '2026.8.18',
    author: 'Model Context Protocol',
    sourceLabel: 'PyPI',
    install: { kind: 'mcp', serverId: 'time', draft: { command: 'uvx', args: ['mcp-server-time==2026.8.18'] } },
    requirements: [
      {
        kind: 'command',
        value: 'uv / uvx',
        required: true,
        description: { en: 'uv on the Host PATH.', zhCN: 'Host 的 PATH 中需安装 uv。' },
      },
    ],
    examples: [
      {
        title: { en: 'Convert a time', zhCN: '换算时间' },
        prompt: { en: 'What time is 3pm Tokyo in Berlin?', zhCN: '东京下午 3 点是柏林几点？' },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: false,
  },
];

export function mockMarketplaceCatalog(): MarketplaceCatalogListData {
  return { entries: MOCK_ENTRIES };
}

export function mockMarketplaceInventory(): MarketplaceInstalledListData {
  return {
    revision: 'mock',
    items: [
      {
        installationKey: 'skill:doc-coauthoring',
        capabilityId: 'doc-coauthoring',
        kind: 'skill',
        name: 'doc-coauthoring',
        catalogEntryId: 'skill:doc-coauthoring',
        availability: 'available',
        enabled: true,
        source: 'user',
        canToggle: true,
        removal: { command: 'skills/uninstall' },
      },
      {
        installationKey: 'extension:goal',
        capabilityId: 'goal',
        kind: 'extension',
        name: 'goal',
        availability: 'pending-apply',
        enabled: true,
        source: 'bundled',
        message: 'Applies at the next run boundary.',
        canToggle: true,
      },
    ],
  };
}
