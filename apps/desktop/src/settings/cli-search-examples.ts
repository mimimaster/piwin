/**
 * Copy-friendly Custom CLI examples for common web-search services.
 *
 * These are configuration examples, not built-in integrations. Except for
 * AnySearch's documented skill CLI, the executable names represent local
 * wrappers that the user must install or write themselves.
 */
export type CliSearchExample = {
  id: string;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  command: string;
  args: readonly string[];
  note: string;
  noteZh: string;
};

export const CLI_SEARCH_EXAMPLES: readonly CliSearchExample[] = [
  {
    id: 'anysearch',
    label: 'AnySearch skill CLI',
    labelZh: 'AnySearch Skill CLI',
    description: 'Official skill CLI; replace the skill path with your local path.',
    descriptionZh: '官方 Skill CLI；把 Skill 路径替换成你本机的实际路径。',
    command: 'python3',
    args: [
      '<anysearch-skill>/scripts/anysearch_cli.py',
      'search',
      '{{query}}',
      '--max_results',
      '5',
    ],
    note: 'Requires the anysearch-skill files and its runtime dependencies.',
    noteZh: '需要先安装 anysearch-skill 及其运行依赖。',
  },
  {
    id: 'searxng',
    label: 'SearXNG wrapper',
    labelZh: 'SearXNG 封装脚本',
    description: 'Use a local wrapper that calls your self-hosted SearXNG instance.',
    descriptionZh: '使用本地 wrapper 调用你自托管的 SearXNG 实例。',
    command: 'searxng-search',
    args: ['{{query}}', '--limit', '5'],
    note: 'The command must exist on PATH; piwin does not install the wrapper.',
    noteZh: '命令必须已经在 PATH 中；piwin 不会自动安装 wrapper。',
  },
  {
    id: 'exa',
    label: 'Exa wrapper',
    labelZh: 'Exa 封装脚本',
    description: 'Example shape for an Exa API wrapper returning JSON hits.',
    descriptionZh: '适用于 Exa API wrapper 返回 JSON hits 的配置形式。',
    command: 'exa-search',
    args: ['{{query}}', '--limit', '5'],
    note: 'Replace exa-search with your own executable or absolute path.',
    noteZh: '把 exa-search 替换成你自己的命令或绝对路径。',
  },
  {
    id: 'serper',
    label: 'Serper wrapper',
    labelZh: 'Serper 封装脚本',
    description: 'Example shape for a Serper Google Search API wrapper.',
    descriptionZh: '适用于 Serper Google Search API wrapper 的配置形式。',
    command: 'serper-search',
    args: ['{{query}}', '--limit', '5'],
    note: 'Keep the SERPER_API_KEY in the wrapper environment, not in this form.',
    noteZh: '把 SERPER_API_KEY 放在 wrapper 环境里，不要直接填进这个表单。',
  },
  {
    id: 'perplexity',
    label: 'Perplexity Sonar wrapper',
    labelZh: 'Perplexity Sonar 封装脚本',
    description: 'Example shape for a Sonar-backed search wrapper.',
    descriptionZh: '适用于 Sonar 搜索 wrapper 的配置形式。',
    command: 'perplexity-search',
    args: ['{{query}}', '--limit', '5'],
    note: 'The wrapper should convert the provider response to {"hits": [...]} JSON.',
    noteZh: 'wrapper 需要把服务商响应转换成 {"hits": [...]} JSON。',
  },
  {
    id: 'brave-or-tavily',
    label: 'Brave / Tavily wrapper',
    labelZh: 'Brave / Tavily 封装脚本',
    description: 'Useful when you need custom headers, routing, or response shaping.',
    descriptionZh: '适合需要自定义 headers、路由或响应格式转换的场景。',
    command: 'my-web-search',
    args: ['{{query}}', '--limit', '5'],
    note: 'Brave and Tavily also have native piwin source cards above.',
    noteZh: 'Brave 和 Tavily 在上面也有 piwin 原生配置卡片。',
  },
];

export function formatCliSearchExample(example: CliSearchExample): string {
  return [example.command, ...example.args].join(' ');
}
