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
    id: 'searxng',
    title: 'SearXNG',
    description: 'Self-hosted instance · URL only',
    descriptionZh: '自托管实例 · 填 URL 即可',
  },
  {
    id: 'cli',
    title: 'Custom CLI',
    description: 'MCP-style command, args, and env — or an HTTP endpoint',
    descriptionZh: '和 MCP 一样填 command / args / env，或走 HTTP',
  },
];

export const FETCH_PROVIDER_OPTIONS = [
  {
    id: 'supermarkdown' as const,
    title: 'Supermarkdown',
    description: 'Local HTML→Markdown · Free default',
    descriptionZh: '本地 HTML 转换 · 默认免费',
  },
  {
    id: 'jina' as const,
    title: 'Jina Reader',
    description: 'r.jina.ai — handles JS-rendered pages',
    descriptionZh: 'r.jina.ai — 适合 JS 渲染',
  },
  {
    id: 'firecrawl' as const,
    title: 'Firecrawl',
    description: 'Scrape API — self-hostable',
    descriptionZh: 'Scrape API — 可自托管',
  },
];
