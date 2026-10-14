/**
 * Mock-Host marketplace fixtures for browser dev and e2e. The real catalog
 * ships inside the Host (`@piwin/marketplace`), which the browser bundle
 * cannot import; these entries only exercise the UI states.
 */
import type {
  MarketplaceCatalogEntry,
  MarketplaceCatalogListData,
  MarketplaceInstalledListData,
  MarketplacePackageDetailData,
  MarketplacePiPackageSource,
  MarketplaceRequirementsCheckData,
  MarketplaceSearchHit,
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
    install: {
      kind: 'pi-package',
      source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' },
    },
    requirements: [],
    examples: [
      {
        title: { en: 'Fix type errors', zhCN: '修复类型错误' },
        prompt: {
          en: 'Refactor src/index.ts without type errors.',
          zhCN: '重构 src/index.ts，并保证没有类型错误。',
        },
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
    install: {
      kind: 'mcp',
      serverId: 'time',
      draft: { command: 'uvx', args: ['mcp-server-time==2026.8.18'] },
    },
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
  {
    entryId: 'skill:webapp-testing',
    capabilityId: 'webapp-testing',
    kind: 'skill',
    category: 'code-development',
    name: { en: 'Web app testing', zhCN: 'Web 应用测试' },
    summary: {
      en: 'Drive a local web app with Playwright and report what broke.',
      zhCN: '用 Playwright 驱动本地 Web 应用并报告问题。',
    },
    description: { en: 'Mock entry.', zhCN: '模拟条目。' },
    version: '34040c9c568585f6929bedeaad110ad08f079624',
    author: 'Anthropic',
    sourceLabel: 'GitHub',
    install: {
      kind: 'skill',
      source: { kind: 'git', url: 'https://github.com/anthropics/skills.git' },
    },
    requirements: [
      {
        kind: 'command',
        value: 'python3 + playwright',
        required: true,
        description: {
          en: 'Python 3 with Playwright on the Host.',
          zhCN: 'Host 上需有 Python 3 与 Playwright。',
        },
      },
    ],
    examples: [
      {
        title: { en: 'Smoke test', zhCN: '冒烟测试' },
        prompt: {
          en: 'Open localhost:3000 and check the login flow.',
          zhCN: '打开 localhost:3000 检查登录流程。',
        },
      },
    ],
    verification: [
      {
        level: 'piwin-tested',
        testedVersion: '34040c9c568585f6929bedeaad110ad08f079624',
        piwinVersion: '0.9.0',
        piVersion: '0.84.0',
        hostOs: 'macos',
        backend: 'sdk',
        testedAt: '2026-10-01',
      },
    ],
    featured: true,
  },
  {
    entryId: 'skill:legacy-notes',
    capabilityId: 'legacy-notes',
    kind: 'skill',
    category: 'docs-research',
    name: { en: 'Legacy notes', zhCN: '旧版笔记' },
    summary: { en: 'Superseded note-taking workflow.', zhCN: '已被替代的笔记流程。' },
    description: { en: 'Mock withdrawn entry.', zhCN: '模拟下架条目。' },
    version: '1.0.0',
    author: 'piwin',
    sourceLabel: 'GitHub',
    install: {
      kind: 'skill',
      source: { kind: 'git', url: 'https://github.com/example/legacy-notes.git' },
    },
    requirements: [],
    examples: [],
    verification: [{ level: 'author-declared' }],
    featured: false,
    withdrawn: {
      reason: { en: 'Superseded by Doc Co-authoring.', zhCN: '已由“文档协作写作”替代。' },
      replacementEntryId: 'skill:doc-coauthoring',
    },
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
        installationKey: 'skill:legacy-notes',
        capabilityId: 'legacy-notes',
        kind: 'skill',
        name: 'legacy-notes',
        catalogEntryId: 'skill:legacy-notes',
        version: '1.0.0',
        availability: 'available',
        enabled: true,
        source: 'user',
        canToggle: true,
        removal: { command: 'skills/uninstall' },
      },
      {
        installationKey: 'mcp:time',
        capabilityId: 'time',
        kind: 'mcp',
        name: 'time',
        catalogEntryId: 'mcp:time',
        version: '2026.7.1',
        availability: 'configuration-required',
        enabled: true,
        source: 'mcp-config',
        message: 'Missing value for TZ',
        messageCode: 'mcp-missing-env',
        messageDetail: 'TZ',
        canToggle: false,
        removal: { command: 'mcp/remove' },
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
        messageCode: 'pending-apply',
        canToggle: true,
      },
    ],
  };
}

const MOCK_BROWSE_HITS: MarketplaceSearchHit[] = [
  {
    entryId: 'npm:pi-lens',
    name: 'pi-lens',
    version: '4.2.1',
    description: 'Duplicate of a curated entry; the page hides it.',
    source: 'npm-pi-package',
    installCommand: 'pi install npm:pi-lens',
    npmUrl: 'https://www.npmjs.com/package/pi-lens',
    monthlyDownloads: 9100,
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
  {
    entryId: 'npm:pi-web-access',
    name: 'pi-web-access',
    version: '1.8.0',
    description: 'Web search and fetch tools for Pi agents.',
    source: 'npm-pi-package',
    installCommand: 'pi install npm:pi-web-access',
    npmUrl: 'https://www.npmjs.com/package/pi-web-access',
    repositoryUrl: 'https://github.com/example/pi-web-access',
    publisher: 'example',
    monthlyDownloads: 4210,
    updatedAt: '2026-09-20T00:00:00.000Z',
  },
  {
    entryId: 'npm:pi-todo',
    name: 'pi-todo',
    version: '0.4.2',
    description: 'A persistent todo list tool the agent can read and update.',
    source: 'npm-pi-package',
    installCommand: 'pi install npm:pi-todo',
    npmUrl: 'https://www.npmjs.com/package/pi-todo',
    publisher: 'someone',
    monthlyDownloads: 1320,
    updatedAt: '2026-10-11T00:00:00.000Z',
  },
  {
    entryId: 'github:example/pi-review',
    name: 'pi-review',
    version: 'main',
    description: 'Git-only review helper (mock).',
    source: 'github',
    installCommand: 'pi install git:github.com/example/pi-review',
    repositoryUrl: 'https://github.com/example/pi-review',
    publisher: 'example',
    stars: 87,
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

export function mockMarketplaceBrowseHits(limit: number | undefined): MarketplaceSearchHit[] {
  return MOCK_BROWSE_HITS.slice(0, limit ?? MOCK_BROWSE_HITS.length);
}

export function mockMarketplacePackageDetail(entryId: string): MarketplacePackageDetailData {
  return {
    entryId,
    license: 'MIT',
    updatedAt: '2026-09-20T00:00:00.000Z',
    readme: [
      '# Mock package',
      '[![npm](https://img.shields.io/npm/v/mock.svg)](https://npmjs.com/mock)',
      '',
      'Adds **mock** tools to the agent.',
      '',
      '## Usage',
      '',
      '```bash',
      'pi install npm:mock',
      '```',
    ].join('\n'),
  };
}

export function mockMarketplaceRequirementsCheck(
  entryId: string,
): MarketplaceRequirementsCheckData {
  const entry = MOCK_ENTRIES.find((item) => item.entryId === entryId);
  return {
    entryId,
    results: (entry?.requirements ?? []).map((requirement, index) => ({
      kind: requirement.kind,
      value: requirement.value,
      required: requirement.required,
      status: index === 0 && requirement.value.includes('+') ? 'unknown' : 'met',
    })),
  };
}

export function mockPackageSourceString(source: MarketplacePiPackageSource): string {
  switch (source.kind) {
    case 'npm':
      return `npm:${source.packageName}`;
    case 'git':
      return `git:${source.repositoryUrl}`;
    case 'local':
      return source.path;
  }
}
