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
  {
    entryId: 'extension:pi-purge',
    capabilityId: 'pi-purge',
    kind: 'extension',
    category: 'code-development',
    name: { en: 'pi-purge prompt swap', zhCN: 'pi-purge 提示词切换' },
    summary: {
      en: '/purge toggles a session between the stock pi system prompt and a persona prompt (strict, replace, or append).',
      zhCN: '用 /purge 在会话中切换 pi 原系统提示词与人设提示词（strict / replace / append）。',
    },
    description: {
      en: 'Session-scoped system-prompt experiments. Off by default, so an idle install changes nothing. /purge swaps the prompt in strict (persona plus working directory only), replace (strip host identity and docs), or append (prepend the persona). Point /purge source at a local file, or keep the bundled example.',
      zhCN: '会话级系统提示词实验。默认关闭，未开启时行为与未安装一致。/purge 按 strict（仅人设和工作目录）、replace（去掉宿主身份与文档段）或 append（人设挂到头部）重写提示词。可用 /purge source 指向本地文件，或沿用内嵌示例。',
    },
    version: '0.2.3',
    author: 'ZiChuanLan',
    homepage: 'https://github.com/ZiChuanLan/pi-purge',
    sourceLabel: 'npm',
    install: {
      kind: 'pi-package',
      source: { kind: 'npm', packageName: 'pi-purge', version: '0.2.3' },
    },
    requirements: [],
    examples: [
      {
        title: { en: 'Toggle a persona prompt', zhCN: '切换人设提示词' },
        prompt: {
          en: 'Turn on /purge in strict mode and answer using only the persona prompt.',
          zhCN: '用 /purge 开启 strict 模式，只按人设提示词来回答。',
        },
      },
    ],
    verification: [{ level: 'author-declared' }],
    featured: true,
  },
];
