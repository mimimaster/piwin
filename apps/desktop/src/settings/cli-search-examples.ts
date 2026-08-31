/**
 * Copy-friendly Custom CLI examples.
 * Only real, fillable commands — not fictional wrapper binaries.
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
    description: 'Same shape as an MCP server: command, args, env.',
    descriptionZh: '和 MCP 一样：command、args、env。',
    command: 'python3',
    args: [
      '<anysearch-skill>/scripts/anysearch_cli.py',
      'search',
      '{{query}}',
      '--max_results',
      '5',
    ],
    note: 'Replace the script path with the skill on this Host. Requires the skill files.',
    noteZh: '把脚本路径换成这台 Host 上的 Skill 路径。需要已安装 anysearch-skill。',
  },
];

export function formatCliSearchExample(example: CliSearchExample): string {
  return [example.command, ...example.args].join(' ');
}
