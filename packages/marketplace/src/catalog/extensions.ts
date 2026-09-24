/**
 * Curated Pi extension packages. Installed through Pi's PackageManager at an
 * exact npm version; none has piwin run evidence yet, so every entry claims
 * author-declared verification only. Launch keeps only packages whose
 * install → inventory → removal loop was exercised end to end (2026-09-25).
 */
import type { MarketplaceCatalogEntry } from '@piwin/contracts';

export const EXTENSION_CATALOG: MarketplaceCatalogEntry[] = [
  {
    entryId: 'extension:ff-labs-pi-fff',
    capabilityId: 'ff-labs-pi-fff',
    kind: 'extension',
    category: 'code-development',
    name: { en: 'pi-fff fuzzy search', zhCN: 'pi-fff 模糊搜索' },
    summary: {
      en: 'Fast fuzzy file-name and content search tools for large repositories.',
      zhCN: '面向大仓库的快速文件名与内容模糊搜索工具。',
    },
    description: {
      en: 'Adds FFF-powered search tools the agent can call when it needs to locate files or symbols by approximate name.',
      zhCN: '新增基于 FFF 的搜索工具，Agent 按近似名称定位文件或符号时调用。',
    },
    version: '0.11.0',
    author: 'dmtrKovalenko',
    homepage: 'https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff',
    sourceLabel: 'npm',
    install: {
      kind: 'pi-package',
      source: { kind: 'npm', packageName: '@ff-labs/pi-fff', version: '0.11.0' },
    },
    requirements: [],
    examples: [
      {
        title: { en: 'Find a file by fuzzy name', zhCN: '按模糊名称找文件' },
        prompt: {
          en: 'Find the file that configures the session store and summarize it.',
          zhCN: '找到配置会话存储的那个文件并总结它。',
        },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: true,
  },
];
