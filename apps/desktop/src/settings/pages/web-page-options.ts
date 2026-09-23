import type { WebSearchSourceKind } from '@piwin/contracts';

export const SOURCE_KIND_OPTIONS: Array<{
  id: WebSearchSourceKind;
  title: string;
  description: string;
  descriptionZh: string;
}> = [
  {
    id: 'duckduckgo',
    title: 'DuckDuckGo',
    description: 'Free · no API key',
    descriptionZh: '免费 · 无需 API Key',
  },
  {
    id: 'brave',
    title: 'Brave',
    description: 'API key · stored on the Host',
    descriptionZh: '需要 API Key · 保存在 Host',
  },
  {
    id: 'tavily',
    title: 'Tavily',
    description: 'API key · stored on the Host',
    descriptionZh: '需要 API Key · 保存在 Host',
  },
  {
    id: 'devin',
    title: 'Devin',
    description: 'Uses the Devin subscription',
    descriptionZh: '使用 Devin 套餐登录',
  },
  {
    id: 'cli',
    title: 'Custom CLI',
    description: 'MCP-style command, args, and env — or an HTTP endpoint',
    descriptionZh: '支持类似 MCP 的 command / args / env，或直接调用 HTTP 接口',
  },
];

export const FETCH_PROVIDER_OPTIONS = [
  {
    id: 'supermarkdown' as const,
    title: 'Supermarkdown',
    description: 'Local HTML→Markdown · Free default',
    descriptionZh: '本地 HTML→Markdown 转换 · 免费',
  },
  {
    id: 'jina' as const,
    title: 'Jina Reader',
    description: 'r.jina.ai — handles JS-rendered pages',
    descriptionZh: 'r.jina.ai — 适合动态渲染页面',
  },
  {
    id: 'firecrawl' as const,
    title: 'Firecrawl',
    description: 'Scrape API — self-hostable',
    descriptionZh: 'Scrape API — 可自托管',
  },
];
