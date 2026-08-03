import { describe, expect, it } from 'vitest';
import { CLI_SEARCH_EXAMPLES, formatCliSearchExample } from './cli-search-examples';

describe('Custom CLI search examples', () => {
  it('includes AnySearch and popular provider examples', () => {
    const exampleIds = CLI_SEARCH_EXAMPLES.map((example) => example.id);

    expect(exampleIds).toEqual([
      'anysearch',
      'searxng',
      'exa',
      'serper',
      'perplexity',
      'brave-or-tavily',
    ]);
  });

  it('keeps query substitution as its own argv token', () => {
    for (const example of CLI_SEARCH_EXAMPLES) {
      expect(example.args).toContain('{{query}}');
    }
  });

  it('formats an example as a readable no-shell command preview', () => {
    const anySearchExample = CLI_SEARCH_EXAMPLES[0];

    expect(anySearchExample).toBeDefined();
    if (!anySearchExample) {
      throw new Error('AnySearch example is missing');
    }
    expect(formatCliSearchExample(anySearchExample)).toBe(
      'python3 <anysearch-skill>/scripts/anysearch_cli.py search {{query}} --max_results 5',
    );
  });
});
